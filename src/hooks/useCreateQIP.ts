import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useWalletClient } from 'wagmi';
import { QIPClient, type QIPContent } from '../services/qipClient';
import { IPFSService, LocalIPFSProvider, PinataProvider } from '../services/ipfsService';

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
  useLocalIPFS?: boolean;
  pinataJwt?: string;
  pinataGateway?: string;
  localIPFSApi?: string;
  localIPFSGateway?: string;
  mutationOptions?: Omit<UseMutationOptions<CreateQIPResult, Error, CreateQIPParams>, 'mutationFn'>;
}

/**
 * Hook to create a new QIP
 */
export function useCreateQIP({
  registryAddress,
  useLocalIPFS = false,
  pinataJwt = '',
  pinataGateway = 'https://gateway.pinata.cloud',
  localIPFSApi = 'http://localhost:5001',
  localIPFSGateway = 'http://localhost:8080',
  mutationOptions = {},
}: UseCreateQIPOptions) {
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  const qipClient = new QIPClient(registryAddress, 'http://localhost:8545', false);
  
  const ipfsService = useLocalIPFS
    ? new IPFSService(new LocalIPFSProvider(localIPFSApi, localIPFSGateway))
    : new IPFSService(new PinataProvider(pinataJwt, pinataGateway));

  return useMutation<CreateQIPResult, Error, CreateQIPParams>({
    mutationFn: async ({ content }) => {
      if (!walletClient) {
        throw new Error('Wallet not connected');
      }


      try {
        // Generate frontmatter
        const frontmatter = {
          qip: 'TBD', // Will be assigned by contract
          title: content.title,
          network: content.network,
          status: 'Draft',
          author: content.author,
          implementor: content.implementor || 'None',
          'implementation-date': 'None',
          proposal: 'None',
          created: new Date().toISOString().split('T')[0],
        };

        // Generate markdown content
        const markdownContent = ipfsService.generateQIPMarkdown(frontmatter, content.content);

        // Upload to IPFS
        console.log('Uploading QIP content to IPFS...');
        const ipfsUrl = await ipfsService.uploadQIP(markdownContent, {
          name: `QIP-${content.title.replace(/\s+/g, '-').toLowerCase()}.md`,
          qipNumber: 'TBD',
          title: content.title,
          author: content.author,
        });

        console.log('IPFS upload successful:', ipfsUrl);

        // Create QIP on blockchain
        console.log('Creating QIP on blockchain...');
        const result = await qipClient.createQIPFromContent(walletClient, content, ipfsUrl);

        console.log('QIP created successfully:', result);

        return {
          qipNumber: result.qipNumber,
          ipfsUrl,
          transactionHash: result.transactionHash,
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