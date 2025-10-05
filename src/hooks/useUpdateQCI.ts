import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useWriteContract, usePublicClient, useReadContract } from 'wagmi';
import { type QCIContent, QCIStatus } from '../services/qciClient';
import { STATUS_ENUM_TO_NAME } from '../config/statusConfig';
import { getIPFSService } from '../services/getIPFSService';
import { config } from '../config/env';
import { QCIRegistryABI } from '../config/abis/QCIRegistry';
import type { Hash } from 'viem';

interface UpdateQCIParams {
  qciNumber: bigint;
  content: QCIContent;
  newStatus?: QCIStatus;
}

interface UpdateQCIResult {
  qciNumber: bigint;
  ipfsUrl: string;
  version: bigint;
  transactionHash: string;
}

interface UseUpdateQCIOptions {
  registryAddress: `0x${string}`;
  mutationOptions?: Omit<UseMutationOptions<UpdateQCIResult, Error, UpdateQCIParams>, 'mutationFn'>;
}

/**
 * Hook to update an existing QCI
 */
export function useUpdateQCI({
  registryAddress,
  mutationOptions = {},
}: UseUpdateQCIOptions) {
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

  // Use centralized IPFS service selection
  const ipfsService = getIPFSService();

  return useMutation<UpdateQCIResult, Error, UpdateQCIParams>({
    mutationFn: async ({ qciNumber, content, newStatus }) => {
      try {
        // Ensure content has qci number set
        const qciContent: QCIContent = {
          ...content,
          qci: Number(qciNumber)
        };

        // Format the full content for IPFS
        const fullContent = ipfsService.formatQCIContent(qciContent);

        // Step 1: Pre-calculate IPFS CID without uploading
        const expectedCID = await ipfsService.calculateCID(fullContent);
        const expectedIpfsUrl = `ipfs://${expectedCID}`;

        // Step 2: Calculate content hash for blockchain
        const contentHash = ipfsService.calculateContentHash(qciContent);

        // Step 3: Update QCI on blockchain
        const txHash = await writeContractAsync({
          address: registryAddress,
          abi: QCIRegistryABI,
          functionName: 'updateQCI',
          args: [qciNumber, content.title, content.chain, content.implementor, contentHash, expectedIpfsUrl, "Updated via web interface"],
        });

        // Wait for transaction confirmation
        await publicClient?.waitForTransactionReceipt({
          hash: txHash,
          confirmations: 1,
        });

        // Step 4: Upload to IPFS with proper metadata AFTER blockchain confirmation
        const actualCID = await ipfsService.provider.upload(fullContent, {
          qciNumber: qciNumber.toString(),
          groupId: config.pinataGroupId
        });

        // Verify CIDs match
        if (actualCID !== expectedCID) {
          console.warn('CID mismatch! Expected:', expectedCID, 'Actual:', actualCID);
        }

        // Update status if provided
        if (newStatus !== undefined && publicClient) {
          // Get current QCI to check status
          const currentQCI = await publicClient.readContract({
            address: registryAddress,
            abi: QCIRegistryABI,
            functionName: 'qcis',
            args: [qciNumber],
          }) as any;

          const currentStatus = currentQCI[8]; // status is at index 8
          if (newStatus !== currentStatus) {
            const statusString = STATUS_ENUM_TO_NAME[newStatus as QCIStatus] ?? "Draft";
            await writeContractAsync({
              address: registryAddress,
              abi: QCIRegistryABI,
              functionName: 'updateStatus',
              args: [qciNumber, statusString],
            });
          }
        }

        // Get updated QCI data for version
        const updatedQCI = await publicClient?.readContract({
          address: registryAddress,
          abi: QCIRegistryABI,
          functionName: 'qcis',
          args: [qciNumber],
        }) as any;

        return {
          qciNumber,
          ipfsUrl: expectedIpfsUrl,
          version: updatedQCI[12], // version is at index 12
          transactionHash: txHash,
        };
      } catch (error) {
        console.error('Error updating QCI:', error);
        if (error instanceof Error) {
          // Check for specific error patterns
          if (error.message.includes('execution reverted')) {
            console.error('Transaction reverted - possible causes:');
            console.error('1. User does not have editor role');
            console.error('2. QCI does not exist');
            console.error('3. QCI status does not allow updates');
            console.error('4. QCI already has snapshot ID');
          }
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      // Invalidate queries to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['qcis'] });
      queryClient.invalidateQueries({ queryKey: ['qci', Number(data.qciNumber)] });
    },
    ...mutationOptions,
  });
}