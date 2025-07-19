import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useWalletClient } from 'wagmi';
import { QIPClient, type QIPContent, QIPStatus } from '../services/qipClient';
import { IPFSService, LocalIPFSProvider, PinataProvider } from '../services/ipfsService';

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
  useLocalIPFS?: boolean;
  pinataJwt?: string;
  pinataGateway?: string;
  localIPFSApi?: string;
  localIPFSGateway?: string;
  mutationOptions?: Omit<UseMutationOptions<UpdateQIPResult, Error, UpdateQIPParams>, 'mutationFn'>;
}

/**
 * Hook to update an existing QIP
 */
export function useUpdateQIP({
  registryAddress,
  useLocalIPFS = false,
  pinataJwt = '',
  pinataGateway = 'https://gateway.pinata.cloud',
  localIPFSApi = 'http://localhost:5001',
  localIPFSGateway = 'http://localhost:8080',
  mutationOptions = {},
}: UseUpdateQIPOptions) {
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  const qipClient = new QIPClient(registryAddress, 'http://localhost:8545', false);
  
  const ipfsService = useLocalIPFS
    ? new IPFSService(new LocalIPFSProvider(localIPFSApi, localIPFSGateway))
    : new IPFSService(new PinataProvider(pinataJwt, pinataGateway));

  return useMutation<UpdateQIPResult, Error, UpdateQIPParams>({
    mutationFn: async ({ qipNumber, content, newStatus }) => {
      if (!walletClient) {
        throw new Error('Wallet not connected');
      }


      try {
        // Get current QIP data to preserve metadata
        const currentQIP = await qipClient.getQIP(qipNumber);
        
        // Generate frontmatter with updated fields
        const frontmatter = {
          qip: qipNumber.toString(),
          title: content.title,
          network: content.network,
          status: newStatus ? qipClient.getStatusString(newStatus) : qipClient.getStatusString(currentQIP.status),
          author: content.author,
          implementor: content.implementor || currentQIP.implementor,
          'implementation-date': currentQIP.implementationDate > 0n 
            ? new Date(Number(currentQIP.implementationDate) * 1000).toISOString().split('T')[0]
            : 'None',
          proposal: currentQIP.snapshotProposalId || 'None',
          created: new Date(Number(currentQIP.createdAt) * 1000).toISOString().split('T')[0],
        };

        // Generate markdown content
        const markdownContent = ipfsService.generateQIPMarkdown(frontmatter, content.content);

        // Upload to IPFS
        console.log('Uploading updated QIP content to IPFS...');
        const ipfsUrl = await ipfsService.uploadQIP(markdownContent, {
          name: `QIP-${qipNumber}.md`,
          qipNumber: qipNumber.toString(),
          title: content.title,
          author: content.author,
          version: (Number(currentQIP.version) + 1).toString(),
        });

        console.log('IPFS upload successful:', ipfsUrl);

        // Update QIP on blockchain
        console.log('Updating QIP on blockchain...');
        const result = await qipClient.updateQIPFromContent(walletClient, qipNumber, content, ipfsUrl);

        // Update status if provided
        if (newStatus !== undefined && newStatus !== currentQIP.status) {
          console.log('Updating QIP status...');
          await qipClient.updateQIPStatus(walletClient, qipNumber, newStatus);
        }

        console.log('QIP updated successfully:', result);

        return {
          qipNumber,
          ipfsUrl,
          version: result.version,
          transactionHash: result.transactionHash,
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