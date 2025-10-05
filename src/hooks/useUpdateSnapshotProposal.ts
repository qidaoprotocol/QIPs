import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useWriteContract, usePublicClient } from 'wagmi';
import type { Address, Hash } from 'viem';
import { QCIRegistryABI } from '../config/abis/QCIRegistry';

interface UpdateSnapshotProposalParams {
  qciNumber: bigint;
  newProposalId: string;
  reason: string;
}

interface UseUpdateSnapshotProposalOptions {
  registryAddress: Address;
  mutationOptions?: Omit<UseMutationOptions<Hash, Error, UpdateSnapshotProposalParams>, 'mutationFn'>;
}

/**
 * Hook to update the Snapshot proposal link for a QCI (moderation)
 * Uses WAGMI's useWriteContract for automatic state management
 */
export function useUpdateSnapshotProposal({ registryAddress, mutationOptions = {} }: UseUpdateSnapshotProposalOptions) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  return useMutation<Hash, Error, UpdateSnapshotProposalParams>({
    mutationFn: async ({ qciNumber, newProposalId, reason }) => {
      // Execute the transaction with gas estimation
      const hash = await writeContractAsync({
        address: registryAddress,
        abi: QCIRegistryABI,
        functionName: 'updateSnapshotProposal',
        args: [qciNumber, newProposalId, reason],
      });

      // Wait for transaction confirmation
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });
      }

      return hash;
    },
    onSuccess: (hash, { qciNumber }) => {
      // Invalidate queries to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['qcis'] });
      queryClient.invalidateQueries({ queryKey: ['qci', Number(qciNumber)] });
    },
    ...mutationOptions,
  });
}
