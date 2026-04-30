import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { getMaiAPIClient } from '../services/maiApiClient';
import { config } from '../config/env';

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
/**
 * The Snapshot space we vote on lives on Ethereum mainnet. Keeping the
 * SIWE message's chainId at 1 makes the wallet pop-up display the
 * familiar mainnet network name; the actual on-chain chain the wallet
 * is connected to is not relevant to a SIWE attestation.
 */
const SIWE_CHAIN_ID = 1;

export function useSiweSession(): UseSiweSessionResult {
  const { address: walletAddress, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<SiweSessionStatus>('idle');
  const [sessionToken, setSessionToken] = useState<string | undefined>(undefined);
  const [authedAddress, setAuthedAddress] = useState<string | undefined>(undefined);

  // If the user disconnects their wallet (or switches accounts), drop the
  // local session — it's no longer attributable to whoever's currently
  // controlling the page.
  useEffect(() => {
    if (!isConnected) {
      setStatus('idle');
      setSessionToken(undefined);
      setAuthedAddress(undefined);
      return;
    }
    if (
      authedAddress &&
      walletAddress &&
      authedAddress.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      setStatus('idle');
      setSessionToken(undefined);
      setAuthedAddress(undefined);
    }
  }, [isConnected, walletAddress, authedAddress]);

  const signIn = useCallback(async (): Promise<
    { ok: true } | { ok: false; reason: SiweSignInError }
  > => {
    if (!isConnected || !walletAddress) {
      return { ok: false, reason: 'no_wallet' };
    }

    setStatus('signing');
    try {
      const client = getMaiAPIClient(config.maiApiUrl);

      // 1. Get a nonce bound to the connecting address.
      const nonceResp = await client.requestQipCommentNonce(walletAddress);

      // 2. Build the SIWE message.
      const issuedAt = new Date();
      const expirationTime = new Date(issuedAt.getTime() + NONCE_TTL_SECONDS * 1000);
      const message = new SiweMessage({
        domain: window.location.host,
        address: walletAddress,
        statement: STATEMENT,
        uri: window.location.origin,
        version: '1',
        chainId: SIWE_CHAIN_ID,
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
        setStatus('idle');
        // Wagmi surfaces a UserRejectedRequestError when the user cancels.
        if (
          err instanceof Error &&
          /reject|denied|cancel/i.test(err.message)
        ) {
          return { ok: false, reason: 'user_rejected' };
        }
        return { ok: false, reason: 'unknown' };
      }

      // 4. Verify with the API and capture the bearer token.
      const verifyResp = await client.verifyQipCommentSignature({
        message: messageBody,
        signature,
      });

      const lowercased = verifyResp.address.toLowerCase();
      setAuthedAddress(lowercased);
      setSessionToken(verifyResp.token);
      setStatus('authenticated');
      return { ok: true };
    } catch {
      setStatus('idle');
      return { ok: false, reason: 'verify_failed' };
    }
  }, [isConnected, walletAddress, signMessageAsync]);

  const signOut = useCallback(() => {
    setStatus('idle');
    setSessionToken(undefined);
    setAuthedAddress(undefined);
  }, []);

  const clearOn401 = useCallback(() => {
    // Same effect as signOut, but the name flags the intent at the call
    // site so it's clear we're reacting to a server-side session expiry,
    // not a user action.
    setStatus('idle');
    setSessionToken(undefined);
    setAuthedAddress(undefined);
  }, []);

  return {
    status,
    address: authedAddress,
    sessionToken,
    isPending: status === 'signing',
    signIn,
    signOut,
    clearOn401,
  };
}
