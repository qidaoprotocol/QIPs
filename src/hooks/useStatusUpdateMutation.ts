import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { QCIStatus } from '../services/qciClient';
import { STATUS_ENUM_TO_NAME } from '../config/statusConfig';
import { toast } from 'react-hot-toast';
import type { Hash } from 'viem';
import { config } from '../config/env';
import { QCIRegistryABI } from '../config/abis/QCIRegistry';

interface StatusUpdateParams {
  qciNumber: bigint;
  newStatus: QCIStatus | string;
  registryAddress: `0x${string}`;
  rpcUrl?: string;
}

/**
 * Mutation hook for updating QCI status
 * Properly integrates with React Query's caching strategy
 */
export function useStatusUpdateMutation() {
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

  return useMutation<Hash, Error, StatusUpdateParams>({
    retry: (failureCount, error) => {
      if (error?.message?.includes("user rejected") ||
          error?.message?.includes("User denied") ||
          error?.message?.includes("User cancelled") ||
          error?.message?.toLowerCase().includes("rejected")) {
        return false;
      }
      return failureCount < 2;
    },
    mutationFn: async ({ qciNumber, newStatus, registryAddress }) => {
      // Convert enum to string status name if needed
      let statusString: string;
      if (typeof newStatus === "string") {
        statusString = newStatus;
      } else {
        statusString = STATUS_ENUM_TO_NAME[newStatus as QCIStatus] ?? "Draft";
      }

      const hash = await writeContractAsync({
        address: registryAddress,
        abi: QCIRegistryABI,
        functionName: 'updateStatus',
        args: [qciNumber, statusString],
      });

      // Wait for transaction confirmation
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });
      }

      // Invalidate backend cache - fire and forget
      const maiApiUrl = config.maiApiUrl || import.meta.env.VITE_MAI_API_URL;
      if (maiApiUrl && config.useMaiApi) {
        fetch(`${maiApiUrl}/v2/cache/invalidate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "status_update",
            qciNumber: Number(qciNumber),
            txHash: hash,
            reason: `Status updated to ${newStatus}`,
          }),
        }).catch((err) => console.error("[StatusUpdate] Cache invalidation failed:", err));
      }

      return hash;
    },

    onMutate: async ({ qciNumber, newStatus }) => {
      // Show loading toast immediately
      toast.loading(`Updating status to ${newStatus}...`, { id: `status-${qciNumber}` });

      // Cancel any outgoing refetches to prevent overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: ["qcis", "api"] });

      // Get current data
      const previousData = queryClient.getQueryData(["qcis", "api"]);

      // Optimistically update to the new value
      queryClient.setQueryData(["qcis", "api"], (old: any) => {
        if (!old) return old;

        // Find the query data structure and update it
        // The actual structure depends on how the data is stored
        const queryKey = Object.keys(old).find((key) => key.includes("forceRefresh") || key === "0");

        if (queryKey && Array.isArray(old[queryKey])) {
          return {
            ...old,
            [queryKey]: old[queryKey].map((qci: any) =>
              qci.qciNumber === Number(qciNumber) ? { ...qci, status: newStatus, statusEnum: newStatus } : qci
            ),
          };
        }

        return old;
      });

      // Also update the full query key structure used by useQCIsFromAPI
      const fullQueryKey = ["qcis", "api", config.maiApiUrl, { includeContent: false, contentFor: undefined, forceRefresh: false }];
      const currentQCIs = queryClient.getQueryData(fullQueryKey) as any[];

      if (currentQCIs) {
        queryClient.setQueryData(
          fullQueryKey,
          currentQCIs.map((qci: any) => (qci.qciNumber === Number(qciNumber) ? { ...qci, status: newStatus, statusEnum: newStatus } : qci))
        );
      }

      return { previousData, qciNumber };
    },

    onError: (err, variables, context: any) => {
      // Dismiss loading toast
      if (context?.qciNumber) {
        toast.dismiss(`status-${context.qciNumber}`);
      }

      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(["qcis", "api"], context.previousData);
      }

      let errorMessage = "Failed to update status";
      if (err.message?.includes("AccessControl")) {
        errorMessage = "You do not have permission to update this status";
      } else if (err.message?.includes("user rejected")) {
        errorMessage = "Transaction cancelled";
      } else if (err.message) {
        errorMessage = err.message;
      }

      toast.error(errorMessage);
    },

    onSuccess: (hash, { qciNumber, newStatus }) => {
      // Replace loading toast with success
      toast.success(`Status updated to ${newStatus}`, { id: `status-${qciNumber}` });

      // Mark queries as stale so they refetch in the background
      // This uses stale-while-revalidate: shows optimistic update while fetching fresh data
      queryClient.invalidateQueries({
        queryKey: ["qcis"],
        refetchType: "active", // Only refetch if the component is mounted
      });
    },

    onSettled: () => {
      // Ensure we always resync with the server after mutation
      // This happens in the background without blocking the UI
      queryClient.invalidateQueries({ queryKey: ["qcis", "api"] });
    },
  });
}