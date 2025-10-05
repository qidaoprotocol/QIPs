import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useWriteContract, usePublicClient } from 'wagmi';
import { type QCIContent } from '../services/qciClient';
import { getIPFSService } from '../services/getIPFSService';
import { config } from '../config/env';
import { QCIRegistryABI } from '../config/abis/QCIRegistry';
import type { Hash } from 'viem';

interface CreateQCIParams {
  content: QCIContent;
}

interface CreateQCIResult {
  qciNumber: bigint;
  ipfsUrl: string;
  transactionHash: string;
}

interface UseCreateQCIOptions {
  registryAddress: `0x${string}`;
  mutationOptions?: Omit<UseMutationOptions<CreateQCIResult, Error, CreateQCIParams>, 'mutationFn'>;
}

/**
 * Hook to create a new QCI
 */
export function useCreateQCI({
  registryAddress,
  mutationOptions = {},
}: UseCreateQCIOptions) {
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

  // Use centralized IPFS service selection
  const ipfsService = getIPFSService();

  return useMutation<CreateQCIResult, Error, CreateQCIParams>({
    mutationFn: async ({ content }) => {
      try {
        // Format the full content for IPFS
        const fullContent = ipfsService.formatQCIContent(content);

        // Step 1: Pre-calculate IPFS CID without uploading
        console.log('🔮 Calculating IPFS CID...');
        const expectedCID = await ipfsService.calculateCID(fullContent);
        const expectedIpfsUrl = `ipfs://${expectedCID}`;
        console.log('✅ Expected CID:', expectedCID);

        // Step 2: Calculate content hash for blockchain
        const contentHash = ipfsService.calculateContentHash(content);

        // Step 3: Create QCI on blockchain with pre-calculated IPFS URL
        console.log('🚀 Creating new QCI on blockchain...');
        const txHash = await writeContractAsync({
          address: registryAddress,
          abi: QCIRegistryABI,
          functionName: 'createQCI',
          args: [content.title, content.chain, contentHash, expectedIpfsUrl],
        });
        console.log('✅ QCI created on blockchain:', { txHash });

        // Wait for transaction receipt to get QCI number
        const receipt = await publicClient?.waitForTransactionReceipt({
          hash: txHash,
          confirmations: 1,
        });

        // Decode QCI number from event logs
        const log = receipt?.logs.find((log) => log.address.toLowerCase() === registryAddress.toLowerCase());
        const qciNumber = log?.topics[1] ? BigInt(log.topics[1]) : BigInt(0);
        console.log('✅ QCI number:', qciNumber);

        // Step 4: Upload to IPFS with proper metadata AFTER blockchain confirmation
        console.log('📤 Uploading to IPFS with metadata...');
        const actualCID = await ipfsService.provider.upload(fullContent, {
          qciNumber: qciNumber > 0 ? qciNumber.toString() : 'pending',
          groupId: config.pinataGroupId
        });

        // Verify CIDs match
        if (actualCID !== expectedCID) {
          console.warn('⚠️ CID mismatch! Expected:', expectedCID, 'Actual:', actualCID);
        } else {
          console.log('✅ IPFS upload successful, CID matches:', actualCID);
        }

        return {
          qciNumber: qciNumber,
          ipfsUrl: expectedIpfsUrl,
          transactionHash: txHash,
        };
      } catch (error) {
        console.error('Error creating QCI:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      // Invalidate QCI list queries to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['qcis'] });
      
      // Prefetch the new QCI data
      queryClient.setQueryData(['qci', Number(data.qciNumber), registryAddress], {
        qciNumber: Number(data.qciNumber),
        ipfsUrl: data.ipfsUrl,
        source: 'blockchain',
        lastUpdated: Date.now(),
      });
    },
    ...mutationOptions,
  });
}