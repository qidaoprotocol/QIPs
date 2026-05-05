import React from 'react';
import { useAccount, useChainId } from 'wagmi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSiweSession } from '@/hooks/useSiweSession';
import { useSafeDeployments, pickSiweChainId } from '@/hooks/useSafeDeployments';

// Minimal chain-id → human label map for the wrong-chain toast.
// Mirrors the chains the Safe-deployment probe checks (mainnet, polygon,
// base, linea); add entries here if useSafeDeployments grows its allowlist.
const CHAIN_LABELS: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  8453: 'Base',
  59144: 'Linea',
};

const chainLabel = (chainId: number): string =>
  CHAIN_LABELS[chainId] ?? `chain ${chainId}`;

/**
 * The auth gate above the comment composer:
 *
 *   no wallet           → small hint pointing the user at the header connect
 *                          button (no second wallet button — the header
 *                          already owns connect UX, and rendering another
 *                          one inline is visually redundant).
 *   wallet, no session  → "Sign in to comment" button → useSiweSession.signIn()
 *   wallet + session    → renders nothing (composer takes over).
 *
 * Sign-in errors map to silent / toast surfaces:
 *   user_rejected → silent (the user just cancelled the wallet popup)
 *   verify_failed → toast (the API rejected the SIWE message)
 *   unknown       → toast (transport error, etc.)
 */
export const SiweLoginButton: React.FC = () => {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { data: safeDeployments } = useSafeDeployments(address);
  const { sessionToken, signIn, isPending } = useSiweSession();

  if (sessionToken) {
    return null;
  }

  if (!isConnected) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect your wallet from the top right to comment.
      </p>
    );
  }

  return (
    <Button
      onClick={async () => {
        const result = await signIn();
        if (result.ok || result.reason === 'user_rejected') return;

        if (result.reason === 'wrong_chain') {
          const targetChainId = pickSiweChainId(walletChainId, safeDeployments);
          toast.error(
            `Switch your wallet to ${chainLabel(targetChainId)} to sign in — your Safe is deployed there.`,
          );
          return;
        }

        toast.error(
          result.reason === 'verify_failed'
            ? "Couldn't verify your signature. Please try again."
            : "Couldn't sign in. Please try again.",
        );
      }}
      disabled={isPending}
    >
      {isPending ? 'Signing in…' : 'Sign in to comment'}
    </Button>
  );
};
