import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { QIPClient, QIPStatus } from '../services/qipClient';
import { IPFSService, LocalIPFSProvider, PinataProvider } from '../services/ipfsService';

export interface QIPData {
  qipNumber: number;
  title: string;
  network: string;
  status: string;
  author: string;
  implementor: string;
  implementationDate: string;
  proposal: string;
  created: string;
  content: string;
  ipfsUrl: string;
  contentHash: string;
  version: number;
  source: 'blockchain' | 'github';
  lastUpdated: number;
}

interface UseQIPDataOptions {
  registryAddress?: `0x${string}`;
  useLocalIPFS?: boolean;
  pinataJwt?: string;
  pinataGateway?: string;
  localIPFSApi?: string;
  localIPFSGateway?: string;
  pollingInterval?: number;
  enabled?: boolean;
}

/**
 * Progressive data fetching for QIPs
 * 1. First loads GitHub markdown files (instant display)
 * 2. Then fetches blockchain data to enhance/override
 * 3. Implements smart caching and polling
 */
export function useQIPData(options: UseQIPDataOptions = {}) {
  const {
    registryAddress,
    useLocalIPFS = false,
    pinataJwt = '',
    pinataGateway = 'https://gateway.pinata.cloud',
    localIPFSApi = 'http://localhost:5001',
    localIPFSGateway = 'http://localhost:8080',
    pollingInterval = 30000, // 30 seconds default
    enabled = true,
  } = options;

  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  // Initialize services
  const qipClient = registryAddress 
    ? new QIPClient(registryAddress, 'http://localhost:8545', false)
    : null;

  const ipfsService = useLocalIPFS
    ? new IPFSService(new LocalIPFSProvider(localIPFSApi, localIPFSGateway))
    : new IPFSService(new PinataProvider(pinataJwt, pinataGateway));

  // Fetch all QIPs from blockchain
  const blockchainQIPsQuery = useQuery({
    queryKey: ['qips', 'blockchain', registryAddress],
    queryFn: async (): Promise<QIPData[]> => {
      console.log("[useQIPData] Starting blockchain fetch, registryAddress:", registryAddress);

      if (!qipClient) {
        console.log("[useQIPData] No qipClient available");
        return [];
      }

      const qips: QIPData[] = [];
      // Query all statuses, union the QIP numbers, then fetch each QIP
      const statuses: QIPStatus[] = [
        QIPStatus.Draft,
        QIPStatus.ReviewPending,
        QIPStatus.VotePending,
        QIPStatus.Approved,
        QIPStatus.Rejected,
        QIPStatus.Implemented,
        QIPStatus.Superseded,
        QIPStatus.Withdrawn,
      ];

      const numbers = new Set<number>();
      for (const status of statuses) {
        try {
          const arr = await qipClient.getQIPsByStatus(status);
          arr.forEach((n) => numbers.add(Number(n)));
        } catch (e) {
          console.warn("[useQIPData] getQIPsByStatus failed for status", status, e);
        }
      }

      const sorted = Array.from(numbers).sort((a, b) => a - b);
      for (const num of sorted) {
        try {
          const qip = await qipClient.getQIP(BigInt(num));
          if (!qip || qip.qipNumber === 0n) continue;

          const ipfsContent = await ipfsService.fetchQIP(qip.ipfsUrl);
          const { frontmatter, content } = ipfsService.parseQIPMarkdown(ipfsContent);

          const implDate =
            qip.implementationDate > 0n ? new Date(Number(qip.implementationDate) * 1000).toISOString().split("T")[0] : "None";

          qips.push({
            qipNumber: num,
            title: qip.title,
            network: qip.network,
            status: qipClient.getStatusString(qip.status),
            author: frontmatter.author || qip.author,
            implementor: qip.implementor,
            implementationDate: implDate,
            proposal: qip.snapshotProposalId || "None",
            created: frontmatter.created || new Date(Number(qip.createdAt) * 1000).toISOString().split("T")[0],
            content,
            ipfsUrl: qip.ipfsUrl,
            contentHash: qip.contentHash,
            version: Number(qip.version),
            source: "blockchain",
            lastUpdated: Date.now(),
          });
        } catch (error) {
          console.error(`[useQIPData] Error fetching QIP ${num}:`, error);
        }
      }

      console.log("[useQIPData] Total blockchain QIPs fetched:", qips.length);
      return qips;
    },
    enabled: enabled && !!registryAddress && !!qipClient,
    refetchInterval: pollingInterval,
    staleTime: 10000, // 10 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Get specific QIP
  const getQIP = (qipNumber: number) => {
    return useQuery({
      queryKey: ['qip', qipNumber, registryAddress],
      queryFn: async (): Promise<QIPData | null> => {
        if (!qipClient) return null;

        try {
          const qip = await qipClient.getQIP(BigInt(qipNumber));
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
            source: 'blockchain',
            lastUpdated: Date.now()
          };
        } catch (error) {
          console.error(`Error fetching QIP ${qipNumber}:`, error);
          return null;
        }
      },
      enabled: enabled && !!registryAddress && !!qipClient && qipNumber > 0,
      staleTime: 30000, // 30 seconds
      gcTime: 10 * 60 * 1000, // 10 minutes
    });
  };

  // Invalidate queries for real-time updates
  const invalidateQIPs = () => {
    queryClient.invalidateQueries({ queryKey: ['qips'] });
  };

  // Prefetch QIP data
  const prefetchQIP = (qipNumber: number) => {
    queryClient.prefetchQuery({
      queryKey: ['qip', qipNumber, registryAddress],
      queryFn: async () => {
        if (!qipClient) return null;
        const qip = await qipClient.getQIP(BigInt(qipNumber));
        // ... (same logic as getQIP)
        return qip;
      },
      staleTime: 30000,
    });
  };

  return {
    // Data
    blockchainQIPs: blockchainQIPsQuery.data || [],
    isLoading: blockchainQIPsQuery.isLoading,
    isError: blockchainQIPsQuery.isError,
    error: blockchainQIPsQuery.error,
    
    // Methods
    getQIP,
    invalidateQIPs,
    prefetchQIP,
    
    // Status
    isFetching: blockchainQIPsQuery.isFetching,
    isStale: blockchainQIPsQuery.isStale,
    dataUpdatedAt: blockchainQIPsQuery.dataUpdatedAt,
  };
}

/**
 * Hook for getting QIPs by status with real-time updates
 */
export function useQIPsByStatus(status: QIPStatus, options: UseQIPDataOptions = {}) {
  const { blockchainQIPs, isLoading, isError, error } = useQIPData(options);
  
  const filteredQIPs = blockchainQIPs.filter(qip => {
    // Map status string back to enum for comparison
    const statusMap: Record<string, QIPStatus> = {
      'Draft': QIPStatus.Draft,
      'Review Pending': QIPStatus.ReviewPending,
      'Vote Pending': QIPStatus.VotePending,
      'Approved': QIPStatus.Approved,
      'Rejected': QIPStatus.Rejected,
      'Implemented': QIPStatus.Implemented,
    };
    
    return statusMap[qip.status] === status;
  });

  return {
    qips: filteredQIPs,
    isLoading,
    isError,
    error,
    count: filteredQIPs.length,
  };
}

/**
 * Hook for real-time QIP count by status
 */
export function useQIPCounts(options: UseQIPDataOptions = {}) {
  const { blockchainQIPs, isLoading } = useQIPData(options);
  
  const counts = blockchainQIPs.reduce((acc, qip) => {
    acc[qip.status] = (acc[qip.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    counts,
    total: blockchainQIPs.length,
    isLoading,
  };
}