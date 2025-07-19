import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { QIPClient, QIPStatus } from '../services/qipClient';
import { IPFSService, LocalIPFSProvider, PinataProvider } from '../services/ipfsService';
import { QIPData } from './useQIPData';

interface UseQIPListOptions {
  registryAddress: `0x${string}`;
  useLocalIPFS?: boolean;
  pinataJwt?: string;
  pinataGateway?: string;
  localIPFSApi?: string;
  localIPFSGateway?: string;
  status?: QIPStatus;
  author?: string;
  network?: string;
  enabled?: boolean;
  pollingInterval?: number;
  queryOptions?: Omit<UseQueryOptions<QIPData[]>, 'queryKey' | 'queryFn'>;
}

/**
 * Hook to fetch all QIPs with optional filtering
 */
export function useQIPList({
  registryAddress,
  useLocalIPFS = false,
  pinataJwt = '',
  pinataGateway = 'https://gateway.pinata.cloud',
  localIPFSApi = 'http://localhost:5001',
  localIPFSGateway = 'http://localhost:8080',
  status,
  author,
  network,
  enabled = true,
  pollingInterval = 30000,
  queryOptions = {},
}: UseQIPListOptions) {
  const qipClient = new QIPClient(registryAddress, 'http://localhost:8545', false);
  
  const ipfsService = useLocalIPFS
    ? new IPFSService(new LocalIPFSProvider(localIPFSApi, localIPFSGateway))
    : new IPFSService(new PinataProvider(pinataJwt, pinataGateway));

  return useQuery<QIPData[]>({
    queryKey: ['qips', 'list', registryAddress, { status, author, network }],
    queryFn: async () => {
      console.log('[useQIPList] Starting fetch with filters:', { status, author, network });
      
      const qips: QIPData[] = [];
      
      // Workaround for contract bug: directly fetch QIPs 209-248
      console.log('[useQIPList] Using workaround to fetch QIPs 209-248 directly');

      for (let qipNum = 209; qipNum <= 248; qipNum++) {
        const qipNumber = BigInt(qipNum);
        try {
          const qip = await qipClient.getQIP(qipNumber);
          
          // Skip if QIP doesn't exist
          if (!qip || qip.qipNumber === 0n) {
            continue;
          }
          
          // Apply filters
          if (status !== undefined && qip.status !== status) {
            continue;
          }
          
          // Fetch content from IPFS
          const ipfsContent = await ipfsService.fetchQIP(qip.ipfsUrl);
          const { frontmatter, content } = ipfsService.parseQIPMarkdown(ipfsContent);
          
          // Apply additional filters
          if (author && qip.author.toLowerCase() !== author.toLowerCase()) {
            continue;
          }
          
          if (network && qip.network.toLowerCase() !== network.toLowerCase()) {
            continue;
          }
          
          const implDate = qip.implementationDate > 0n 
            ? new Date(Number(qip.implementationDate) * 1000).toISOString().split('T')[0]
            : 'None';
          
          qips.push({
            qipNumber: Number(qipNumber),
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
            source: 'blockchain',
            lastUpdated: Date.now()
          });
        } catch (error) {
          console.error(`Error fetching QIP ${qipNumber}:`, error);
        }
      }

      console.log('[useQIPList] Total QIPs fetched:', qips.length);
      return qips;
    },
    enabled: enabled && !!registryAddress,
    refetchInterval: pollingInterval,
    staleTime: 10 * 1000, // 10 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    ...queryOptions,
  });
}