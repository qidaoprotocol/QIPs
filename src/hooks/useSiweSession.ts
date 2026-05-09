import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAccount, useChainId, useSignMessage, useSwitchChain } from 'wagmi';
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
  | 'wrong_chain'
  | 'verify_failed'
  | 'unknown';

export interface UseSiweSessionResult {
  status: SiweSessionStatus;
  /** Lowercased authenticated address, present iff status === 'authenticated'. */
  address?: string;
  /**
   * Bearer token. Persisted in `localStorage` under a versioned key; cleared
   * on sign-out, 401, wallet switch, expiry, or actively-disconnected state.
   */
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

/* ─────────────────────────────────────────────────────────
   Persisted session (localStorage)
   ─────────────────────────────────────────────────────────
   The bearer token returned by /v2/auth/qip-comments/verify also lives in
   an HttpOnly Set-Cookie, but mai-api and the QIPs frontend are cross-origin
   in dev (mai-api.qidao.localhost ↔ qips.qidao.localhost) and prod, and the
   cookie is SameSite=Strict in prod — i.e. the cookie is never sent on
   cross-origin requests. The verify response carries the bearer in JSON for
   exactly this case. We persist {token, address, expiresAt} so a page reload
   doesn't strand the user back on the sign-in button. Threat model: the
   token authorizes posting comments under the connected address; the VP
   gate stays server-side. Bumping the key version (v1 → v2) invalidates
   stale entries instantly if the persisted shape ever changes.
*/
const PERSISTED_SESSION_KEY = 'qip-comments:siwe-session:v1';

interface PersistedSessionEntry {
  token: string;
  address: string;
  expiresAt: string;
}

function clearPersistedSession(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PERSISTED_SESSION_KEY);
  } catch {
    // Storage disabled or quota error — non-fatal.
  }
}

function readPersistedSession(): SessionState | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(PERSISTED_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSessionEntry>;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.address !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      clearPersistedSession();
      return null;
    }
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      clearPersistedSession();
      return null;
    }
    return {
      status: 'authenticated',
      sessionToken: parsed.token,
      address: parsed.address.toLowerCase(),
    };
  } catch {
    clearPersistedSession();
    return null;
  }
}

function writePersistedSession(token: string, address: string, expiresAt: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const entry: PersistedSessionEntry = {
      token,
      address: address.toLowerCase(),
      expiresAt,
    };
    localStorage.setItem(PERSISTED_SESSION_KEY, JSON.stringify(entry));
  } catch {
    // Storage disabled or quota error — non-fatal; in-memory session still works.
  }
}

// Hydrate the singleton from persisted state once at module init, before any
// component mounts. Reading at module scope avoids a first-render flicker
// where the sign-in button would briefly render before a useEffect could
// pull the persisted entry.
{
  const persisted = readPersistedSession();
  if (persisted !== null) {
    sessionState = persisted;
  }
}

export function useSiweSession(): UseSiweSessionResult {
  const { address: walletAddress, isConnected, status: accountStatus } = useAccount();
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
  const { switchChainAsync } = useSwitchChain();

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
  // controlling the page. Use `status === 'disconnected'` rather than
  // `!isConnected`: on page reload wagmi briefly reports disconnected
  // while it reconnects ('connecting' / 'reconnecting' transient states),
  // and dropping the session there would defeat the persistence layer.
  useEffect(() => {
    if (accountStatus === 'disconnected') {
      if (sessionState.sessionToken !== undefined || sessionState.status !== 'idle') {
        clearPersistedSession();
        setSessionState({ status: 'idle', sessionToken: undefined, address: undefined });
      }
      return;
    }
    if (
      sessionState.address &&
      walletAddress &&
      sessionState.address.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      clearPersistedSession();
      setSessionState({ status: 'idle', sessionToken: undefined, address: undefined });
    }
  }, [accountStatus, walletAddress]);

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

      // 2a. If the wallet is on a different chain than where the Safe lives,
      // switch first. EIP-1271 verification reads `isValidSignature` from
      // the chain in the SIWE message, but the wallet (e.g. Rabby's
      // Safe-import flow) only proposes signatures via the Safe Transaction
      // Service for its currently-selected chain. Without this switch,
      // signing either silently fails or the wallet signs against the
      // wrong chain and verify rejects.
      if (walletChainId !== siweChainId) {
        try {
          await switchChainAsync({ chainId: siweChainId });
        } catch (err) {
          setSessionState({ ...sessionState, status: 'idle' });
          // User rejected the network switch, or the wallet doesn't
          // support programmatic switches.
          return { ok: false, reason: 'wrong_chain' };
        }
      }

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
      writePersistedSession(verifyResp.token, lowercased, verifyResp.expiresAt);
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
  }, [isConnected, walletAddress, walletChainId, safeDeployments, signMessageAsync, switchChainAsync]);

  const signOut = useCallback(() => {
    clearPersistedSession();
    setSessionState({ status: 'idle', sessionToken: undefined, address: undefined });
  }, []);

  const clearOn401 = useCallback(() => {
    // Same effect as signOut, but the name flags the intent at the call
    // site so it's clear we're reacting to a server-side session expiry,
    // not a user action.
    clearPersistedSession();
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
