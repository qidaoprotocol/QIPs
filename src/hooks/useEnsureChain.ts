import { useCallback } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';

export class ChainSwitchRejectedError extends Error {
  readonly targetChainId: number;
  readonly currentChainId: number | undefined;

  constructor(targetChainId: number, currentChainId: number | undefined, cause?: unknown) {
    super(`User rejected chain switch to ${targetChainId}`);
    this.name = 'ChainSwitchRejectedError';
    this.targetChainId = targetChainId;
    this.currentChainId = currentChainId;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export interface UseEnsureChainResult {
  /** Resolves once the wallet reports `targetChainId`. Throws if the user rejects or no wallet is connected. */
  ensureChain: () => Promise<void>;
  /** True iff the wallet is currently on the target chain. */
  isOnChain: boolean;
  /** Wallet's current chainId, or undefined when no wallet is connected. */
  currentChainId: number | undefined;
  /** True while a switchChain call is in flight. Buttons should disable on this. */
  switching: boolean;
  /** Echoes the chainId the caller asked the wallet to be on. */
  targetChainId: number;
}

/**
 * Guarantee the wallet is on `targetChainId` before issuing a transaction.
 *
 * Components and mutation hooks that write to a contract on a specific chain
 * should call this hook with that chain's id, then `await ensureChain()`
 * before invoking estimateContractGas / simulateContract / writeContract.
 *
 * Read clients used inside the same write path should pin to the target
 * chain via `usePublicClient({ chainId: targetChainId })` so a stale wallet
 * RPC cannot poison gas estimation.
 */
export function useEnsureChain(targetChainId: number): UseEnsureChainResult {
  const { isConnected } = useAccount();
  const currentChainId = useChainId();
  const { switchChainAsync, isPending } = useSwitchChain();

  const isOnChain = isConnected && currentChainId === targetChainId;

  const ensureChain = useCallback(async () => {
    if (!isConnected) {
      throw new Error('Wallet is not connected');
    }
    if (currentChainId === targetChainId) {
      return;
    }
    try {
      await switchChainAsync({ chainId: targetChainId });
    } catch (err) {
      if (isUserRejection(err)) {
        throw new ChainSwitchRejectedError(targetChainId, currentChainId, err);
      }
      throw err;
    }
  }, [isConnected, currentChainId, targetChainId, switchChainAsync]);

  return {
    ensureChain,
    isOnChain,
    currentChainId: isConnected ? currentChainId : undefined,
    switching: isPending,
    targetChainId,
  };
}

function isUserRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown };
  if (e.name === 'UserRejectedRequestError') return true;
  if (e.code === 4001) return true; // EIP-1193
  if (typeof e.message === 'string' && /user rejected|user denied/i.test(e.message)) return true;
  return false;
}
