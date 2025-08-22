import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useWalletClient } from 'wagmi';
import { QIPClient, type QIPContent } from '../services/qipClient';
import { IPFSService } from '../services/ipfsService';
import { getIPFSService } from '../services/getIPFSService';
import { config } from '../config/env';

interface CreateQIPParams {
  content: QIPContent;
}

interface CreateQIPResult {
  qipNumber: bigint;
  ipfsUrl: string;
  transactionHash: string;
}

interface UseCreateQIPOptions {
  registryAddress: `0x${string}`;
  mutationOptions?: Omit<UseMutationOptions<CreateQIPResult, Error, CreateQIPParams>, 'mutationFn'>;
}

/**
 * Hook to create a new QIP
 */
export function useCreateQIP({
  registryAddress,
  mutationOptions = {},
}: UseCreateQIPOptions) {
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  const qipClient = new QIPClient(registryAddress, config.baseRpcUrl, false);
  
  // Use centralized IPFS service selection
  const ipfsService = getIPFSService();

  return useMutation<CreateQIPResult, Error, CreateQIPParams>({
    mutationFn: async ({ content }) => {
      if (!walletClient) {
        throw new Error('Wallet not connected');
      }


      try {
        // Format the full content for IPFS
        const fullContent = ipfsService.formatQIPContent(content);
        
        // Step 1: Pre-calculate IPFS CID without uploading
        console.log('🔮 Calculating IPFS CID...');
        const expectedCID = await ipfsService.calculateCID(fullContent);
        const expectedIpfsUrl = `ipfs://${expectedCID}`;
        console.log('✅ Expected CID:', expectedCID);
        
        // Step 2: Calculate content hash for blockchain
        const contentHash = ipfsService.calculateContentHash(content);

        // Step 3: Create QIP on blockchain with pre-calculated IPFS URL
        console.log('🚀 Creating new QIP on blockchain...');
        const result = await qipClient.createQIP(
          walletClient,
          content.title,
          content.network,
          contentHash,
          expectedIpfsUrl
        );
        const txHash = result.hash;
        const qipNumber = result.qipNumber;
        console.log('✅ QIP created on blockchain:', { txHash, qipNumber });
        
        // Step 4: Upload to IPFS with proper metadata AFTER blockchain confirmation
        console.log('📤 Uploading to IPFS with metadata...');
        const actualCID = await ipfsService.provider.upload(fullContent, {
          qipNumber: qipNumber > 0 ? qipNumber.toString() : 'pending',
          groupId: config.pinataGroupId
        });
        
        // Verify CIDs match
        if (actualCID !== expectedCID) {
          console.warn('⚠️ CID mismatch! Expected:', expectedCID, 'Actual:', actualCID);
        } else {
          console.log('✅ IPFS upload successful, CID matches:', actualCID);
        }

        return {
          qipNumber: qipNumber,
          ipfsUrl: expectedIpfsUrl,
          transactionHash: txHash,
        };
      } catch (error) {
        console.error('Error creating QIP:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      // Invalidate QIP list queries to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['qips'] });
      
      // Prefetch the new QIP data
      queryClient.setQueryData(['qip', Number(data.qipNumber), registryAddress], {
        qipNumber: Number(data.qipNumber),
        ipfsUrl: data.ipfsUrl,
        source: 'blockchain',
        lastUpdated: Date.now(),
      });
    },
    ...mutationOptions,
  });
}