import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useWalletClient } from 'wagmi';
import { QIPClient, type QIPContent, QIPStatus } from '../services/qipClient';
import { IPFSService } from '../services/ipfsService';
import { getIPFSService } from '../services/getIPFSService';
import { config } from '../config/env';

interface UpdateQIPParams {
  qipNumber: bigint;
  content: QIPContent;
  newStatus?: QIPStatus;
}

interface UpdateQIPResult {
  qipNumber: bigint;
  ipfsUrl: string;
  version: bigint;
  transactionHash: string;
}

interface UseUpdateQIPOptions {
  registryAddress: `0x${string}`;
  mutationOptions?: Omit<UseMutationOptions<UpdateQIPResult, Error, UpdateQIPParams>, 'mutationFn'>;
}

/**
 * Hook to update an existing QIP
 */
export function useUpdateQIP({
  registryAddress,
  mutationOptions = {},
}: UseUpdateQIPOptions) {
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  const qipClient = new QIPClient(registryAddress, config.baseRpcUrl, false);
  
  // Use centralized IPFS service selection
  const ipfsService = getIPFSService();

  return useMutation<UpdateQIPResult, Error, UpdateQIPParams>({
    mutationFn: async ({ qipNumber, content, newStatus }) => {
      if (!walletClient) {
        throw new Error('Wallet not connected');
      }


      try {
        // Ensure content has qip number set
        const qipContent: QIPContent = {
          ...content,
          qip: Number(qipNumber)
        };

        // Format the full content for IPFS
        const fullContent = ipfsService.formatQIPContent(qipContent);
        
        // Step 1: Pre-calculate IPFS CID without uploading
        console.log('🔮 Calculating IPFS CID...');
        const expectedCID = await ipfsService.calculateCID(fullContent);
        const expectedIpfsUrl = `ipfs://${expectedCID}`;
        console.log('✅ Expected CID:', expectedCID);
        
        // Step 2: Calculate content hash for blockchain
        const contentHash = ipfsService.calculateContentHash(qipContent);

        // Step 3: Update QIP on blockchain with pre-calculated IPFS URL
        console.log('📝 Updating QIP on blockchain...');
        const txHash = await qipClient.updateQIP(
          walletClient,
          qipNumber,
          content.title,
          contentHash,
          expectedIpfsUrl,
          'Updated via web interface'
        );
        console.log('✅ Blockchain update successful:', txHash);
        
        // Step 4: Upload to IPFS with proper metadata AFTER blockchain confirmation
        console.log('📤 Uploading to IPFS with metadata...');
        const actualCID = await ipfsService.provider.upload(fullContent, {
          qipNumber: qipNumber.toString(),
          groupId: config.pinataGroupId
        });
        
        // Verify CIDs match
        if (actualCID !== expectedCID) {
          console.warn('⚠️ CID mismatch! Expected:', expectedCID, 'Actual:', actualCID);
        } else {
          console.log('✅ IPFS upload successful, CID matches:', actualCID);
        }

        // Update status if provided
        if (newStatus !== undefined) {
          // Get current QIP to check status
          const currentQIP = await qipClient.getQIP(qipNumber);
          if (newStatus !== currentQIP.status) {
            console.log('Updating QIP status...');
            await qipClient.updateQIPStatus(walletClient, qipNumber, newStatus);
          }
        }

        // Get updated QIP data for version
        const updatedQIP = await qipClient.getQIP(qipNumber);

        return {
          qipNumber,
          ipfsUrl: expectedIpfsUrl,
          version: updatedQIP.version,
          transactionHash: txHash,
        };
      } catch (error) {
        console.error('Error updating QIP:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      // Invalidate queries to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['qips'] });
      queryClient.invalidateQueries({ queryKey: ['qip', Number(data.qipNumber)] });
    },
    ...mutationOptions,
  });
}