import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { QIPClient } from '../services/qipClient';
import { IPFSService, LocalIPFSProvider, PinataProvider } from '../services/ipfsService';
import { QIPData } from './useQIPData';

interface UseQIPOptions {
  registryAddress: `0x${string}`;
  qipNumber: number;
  useLocalIPFS?: boolean;
  pinataJwt?: string;
  pinataGateway?: string;
  localIPFSApi?: string;
  localIPFSGateway?: string;
  rpcUrl?: string;
  enabled?: boolean;
  queryOptions?: Omit<UseQueryOptions<QIPData | null>, 'queryKey' | 'queryFn'>;
}

/**
 * Hook to fetch a single QIP with its content
 */
export function useQIP({
  registryAddress,
  qipNumber,
  useLocalIPFS = false,
  pinataJwt = '',
  pinataGateway = 'https://gateway.pinata.cloud',
  localIPFSApi = 'http://localhost:5001',
  localIPFSGateway = 'http://localhost:8080',
  rpcUrl = 'http://localhost:8545',
  enabled = true,
  queryOptions = {},
}: UseQIPOptions) {
  const qipClient = new QIPClient(registryAddress, rpcUrl, false);
  
  const ipfsService = useLocalIPFS
    ? new IPFSService(new LocalIPFSProvider(localIPFSApi, localIPFSGateway))
    : new IPFSService(new PinataProvider(pinataJwt, pinataGateway));

  return useQuery<QIPData | null>({
    queryKey: ['qip', qipNumber, registryAddress],
    queryFn: async () => {
      if (!qipClient || qipNumber <= 0) return null;

      try {
        const qip = await qipClient.getQIP(BigInt(qipNumber));
        
        // Check if QIP exists
        if (!qip || qip.qipNumber === 0n) {
          return null;
        }

        // Fetch content from IPFS
        const ipfsContent = await ipfsService.fetchQIP(qip.ipfsUrl);
        const { frontmatter, content } = ipfsService.parseQIPMarkdown(ipfsContent);
        
        const implDate = qip.implementationDate > 0n 
          ? new Date(Number(qip.implementationDate) * 1000).toISOString().split('T')[0]
          : 'None';
        
        return {
          qipNumber,
          title: qip.title,
          network: qip.network,
          status: qipClient.getStatusString(qip.status),
          author: frontmatter.author || qip.author,
          implementor: qip.implementor,
          implementationDate: implDate,
          proposal: qip.snapshotProposalId || 'None',
          created: frontmatter.created || new Date(Number(qip.createdAt) * 1000).toISOString().split('T')[0],
          content,
          ipfsUrl: qip.ipfsUrl,
          contentHash: qip.contentHash,
          version: Number(qip.version),
          source: 'blockchain' as const,
          lastUpdated: Date.now()
        };
      } catch (error) {
        console.error(`Error fetching QIP ${qipNumber}:`, error);
        throw error;
      }
    },
    enabled: enabled && !!registryAddress && qipNumber > 0,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    ...queryOptions,
  });
}