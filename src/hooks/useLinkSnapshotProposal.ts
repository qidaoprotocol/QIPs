import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useWriteContract, usePublicClient } from 'wagmi';
import type { Address, Hash } from 'viem';
import { QCIRegistryABI } from '../config/abis/QCIRegistry';

interface LinkSnapshotProposalParams {
  qciNumber: bigint;
  proposalId: string;
}

interface UseLinkSnapshotProposalOptions {
  registryAddress: Address;
  mutationOptions?: Omit<UseMutationOptions<Hash, Error, LinkSnapshotProposalParams>, 'mutationFn'>;
}

/**
 * Hook to link a Snapshot proposal to a QCI
 * Uses WAGMI's useWriteContract for automatic state management
 */
export function useLinkSnapshotProposal({ registryAddress, mutationOptions = {} }: UseLinkSnapshotProposalOptions) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  return useMutation<Hash, Error, LinkSnapshotProposalParams>({
    mutationFn: async ({ qciNumber, proposalId }) => {
      // Execute the transaction with gas estimation
      const hash = await writeContractAsync({
        address: registryAddress,
        abi: QCIRegistryABI,
        functionName: 'linkSnapshotProposal',
        args: [qciNumber, proposalId],
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
