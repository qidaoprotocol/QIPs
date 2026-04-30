import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAccount, useChainId, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { getMaiAPIClient } from '../services/maiApiClient';
import { config } from '../config/env';
import { pickSiweChainId, useSafeDeployments } from './useSafeDeployments';

export type SiweSessionStatus = 'idle' | 'signing' | 'authenticated';

/**
 * Reason a sign-in attempt did not produce a session. The caller renders
 * these as toasts; "user_rejected" is silent because the user just clicked
 * cancel in the wallet.
 */
export type SiweSignInError =
  | 'no_wallet'
  | 'user_rejected'
  | 'verify_failed'
  | 'unknown';

export interface UseSiweSessionResult {
  status: SiweSessionStatus;
  /** Lowercased authenticated address, present iff status === 'authenticated'. */
  address?: string;
  /** In-memory bearer token. Never persisted to localStorage / sessionStorage. */
  sessionToken?: string;
  isPending: boolean;

  /** Run the nonce → sign → verify dance. Throws nothing; errors surface as `error` state. */
  signIn: () => Promise<{ ok: true } | { ok: false; reason: SiweSignInError }>;
  /** Clear local session state. Best-effort; the cookie is left in place. */
  signOut: () => void;
  /**
   * Force-clear the session because an authenticated request returned 401.
   * Called by the parent component when a comment POST surfaces an expired
   * session, so the user is prompted to sign in again.
   */
  clearOn401: () => void;
}

const STATEMENT = 'Sign in to leave a comment on this QIP.';
const NONCE_TTL_SECONDS = 10 * 60;

/* ─────────────────────────────────────────────────────────
   Shared session state (module-scoped singleton)
   ─────────────────────────────────────────────────────────
   Every consumer of useSiweSession needs to see the same token and status,
   not its own local copy. Without a shared store, signing in inside one
   component's tree leaves siblings unaware that a session exists, so the
   composer never replaces the login button.
 */

interface SessionState {
  status: SiweSessionStatus;
  sessionToken: string | undefined;
  address: string | undefined;
}

let sessionState: SessionState = {
  status: 'idle',
  sessionToken: undefined,
  address: undefined,
};

const subscribers = new Set<() => void>();

function getSessionSnapshot(): SessionState {
  return sessionState;
}

function setSessionState(next: SessionState): void {
  sessionState = next;
  for (const listener of subscribers) listener();
}

function subscribeSessionState(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useSiweSession(): UseSiweSessionResult {
  const { address: walletAddress, isConnected } = useAccount();
  // EIP-4361 requires a chainId in the SIWE message. For EOAs it is
  // informational; for smart-account signers (Safe and other EIP-1271
  // wallets) it tells the verifier which chain's RPC to query for
  // `isValidSignature`. The wallet's reported chain is the right answer
  // when the wallet is actually on its Safe's home chain, but Safes are
  // often connected through wrappers (Rabby's Safe import, ConnectKit's
  // initialChainId on Base) where the wallet may report a chain that
  // doesn't match where the Safe is deployed. So we additionally probe
  // the Safe Transaction Service to find the deployment chain(s) and let
  // pickSiweChainId resolve the right answer.
  const walletChainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  // Kick off the deployment probe as soon as a wallet is connected — by
  // the time the user clicks the sign-in button, the result is usually
  // already cached. If the probe is still inflight or returned only
  // unknowns, pickSiweChainId falls back to walletChainId so a flaky
  // Safe TX Service never blocks sign-in.
  const { data: safeDeployments } = useSafeDeployments(walletAddress);

  const state = useSyncExternalStore(
    subscribeSessionState,
    getSessionSnapshot,
    getSessionSnapshot,
  );

  // If the user disconnects their wallet (or switches accounts), drop the
  // local session — it's no longer attributable to whoever's currently
  // controlling the page.
  useEffect(() => {
    if (!isConnected) {
      if (sessionState.sessionToken !== undefined || sessionState.status !== 'idle') {
        setSessionState({ status: 'idle', sessionToken: undefined, address: undefined });
      }
      return;
    }
    if (
      sessionState.address &&
      walletAddress &&
      sessionState.address.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      setSessionState({ status: 'idle', sessionToken: undefined, address: undefined });
    }
  }, [isConnected, walletAddress]);

  const signIn = useCallback(async (): Promise<
    { ok: true } | { ok: false; reason: SiweSignInError }
  > => {
    if (!isConnected || !walletAddress) {
      return { ok: false, reason: 'no_wallet' };
    }

    setSessionState({ ...sessionState, status: 'signing' });
    try {
      const client = getMaiAPIClient(config.maiApiUrl);

      // 1. Get a nonce bound to the connecting address.
      const nonceResp = await client.requestQipCommentNonce(walletAddress);

      // 2. Build the SIWE message.
      const issuedAt = new Date();
      const expirationTime = new Date(issuedAt.getTime() + NONCE_TTL_SECONDS * 1000);
      const siweChainId = pickSiweChainId(walletChainId, safeDeployments);
      const message = new SiweMessage({
        domain: window.location.host,
        address: walletAddress,
        statement: STATEMENT,
        uri: window.location.origin,
        version: '1',
        chainId: siweChainId,
        nonce: nonceResp.nonce,
        issuedAt: issuedAt.toISOString(),
        expirationTime: expirationTime.toISOString(),
      });
      const messageBody = message.prepareMessage();

      // 3. Sign with the connected wallet. User rejection lands in the catch.
      let signature: string;
      try {
        signature = await signMessageAsync({ message: messageBody });
      } catch (err) {
        setSessionState({ ...sessionState, status: 'idle' });
        if (
          err instanceof Error &&
          /reject|denied|cancel/i.test(err.message)
        ) {
          return { ok: false, reason: 'user_rejected' };
        }
        return { ok: false, reason: 'unknown' };
      }

      // 4. Verify with the API and capture the bearer token.
      let verifyResp;
      try {
        verifyResp = await client.verifyQipCommentSignature({
          message: messageBody,
          signature,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[useSiweSession] verify failed:', err);
        setSessionState({ ...sessionState, status: 'idle' });
        return { ok: false, reason: 'verify_failed' };
      }

      const lowercased = verifyResp.address.toLowerCase();
      setSessionState({
        status: 'authenticated',
        sessionToken: verifyResp.token,
        address: lowercased,
      });
      return { ok: true };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[useSiweSession] sign-in failed before verify:', err);
      setSessionState({ ...sessionState, status: 'idle' });
      return { ok: false, reason: 'unknown' };
    }
  }, [isConnected, walletAddress, walletChainId, safeDeployments, signMessageAsync]);

  const signOut = useCallback(() => {
    setSessionState({ status: 'idle', sessionToken: undefined, address: undefined });
  }, []);

  const clearOn401 = useCallback(() => {
    // Same effect as signOut, but the name flags the intent at the call
    // site so it's clear we're reacting to a server-side session expiry,
    // not a user action.
    setSessionState({ status: 'idle', sessionToken: undefined, address: undefined });
  }, []);

  return {
    status: state.status,
    address: state.address,
    sessionToken: state.sessionToken,
    isPending: state.status === 'signing',
    signIn,
    signOut,
    clearOn401,
  };
}
