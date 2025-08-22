import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { QIPClient, QIPStatus } from '../services/qipClient';
import { IPFSService } from '../services/ipfsService';
import { getIPFSService } from '../services/getIPFSService';
import { config } from '../config/env';

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
    pollingInterval = 30000, // 30 seconds default
    enabled = true,
  } = options;

  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  // Initialize services (memoized to avoid recreating on every render)
  const qipClient = React.useMemo(() => 
    registryAddress 
      ? new QIPClient(registryAddress, undefined, false) // Let QIPClient use load balancing
      : null,
    [registryAddress]
  );

  // Use centralized IPFS service selection
  const ipfsService = getIPFSService();

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
      
      // Step 1: Get all QIP numbers by status in a single multicall
      console.log("[useQIPData] Fetching all QIPs by status using multicall...");
      const statusMap = await qipClient.getAllQIPsByStatusBatch();
      
      // Collect all unique QIP numbers
      const numbers = new Set<bigint>();
      for (const qipNumbers of statusMap.values()) {
        qipNumbers.forEach(n => numbers.add(n));
      }
      
      console.log(`[useQIPData] Found ${numbers.size} unique QIPs across all statuses`);
      
      if (numbers.size === 0) {
        return [];
      }

      // Step 2: Batch fetch all QIPs in chunks to avoid overwhelming the RPC
      const BATCH_SIZE = 5; // Reduced to 5 to avoid gas limits
      const sortedNumbers = Array.from(numbers).sort((a, b) => Number(a - b));
      
      for (let i = 0; i < sortedNumbers.length; i += BATCH_SIZE) {
        const batch = sortedNumbers.slice(i, Math.min(i + BATCH_SIZE, sortedNumbers.length));
        console.log(`[useQIPData] Fetching batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(sortedNumbers.length/BATCH_SIZE)} (${batch.length} QIPs)`);
        
        try {
          // Fetch QIP data using multicall
          const batchQIPs = await qipClient.getQIPsBatch(batch);
          
          // Process each QIP with IPFS content
          for (const qip of batchQIPs) {
            if (!qip || qip.qipNumber === 0n) continue;
            
            try {
              const ipfsContent = await ipfsService.fetchQIP(qip.ipfsUrl);
              const { frontmatter, content } = ipfsService.parseQIPMarkdown(ipfsContent);

              const implDate =
                qip.implementationDate > 0n 
                  ? new Date(Number(qip.implementationDate) * 1000).toISOString().split("T")[0] 
                  : "None";

              qips.push({
                qipNumber: Number(qip.qipNumber),
                title: qip.title,
                network: qip.network,
                status: qipClient.getStatusString(qip.status),
                author: frontmatter.author || qip.author,
                implementor: qip.implementor,
                implementationDate: implDate,
                // Filter out TBU and other placeholders
                proposal: (qip.snapshotProposalId && 
                          qip.snapshotProposalId !== 'TBU' && 
                          qip.snapshotProposalId !== 'tbu' &&
                          qip.snapshotProposalId !== 'None') 
                          ? qip.snapshotProposalId 
                          : 'None',
                created: frontmatter.created || new Date(Number(qip.createdAt) * 1000).toISOString().split("T")[0],
                content,
                ipfsUrl: qip.ipfsUrl,
                contentHash: qip.contentHash,
                version: Number(qip.version),
                source: "blockchain",
                lastUpdated: Date.now(),
              });
            } catch (error) {
              console.error(`[useQIPData] Error processing QIP ${qip.qipNumber}:`, error);
            }
          }
          
          // Add progressive delay between batches to avoid rate limiting
          if (i + BATCH_SIZE < sortedNumbers.length) {
            // Exponential backoff: 100ms, 200ms, 300ms, etc.
            const delay = Math.min(100 * (Math.floor(i/BATCH_SIZE) + 1), 500);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          console.error(`[useQIPData] Error fetching batch:`, error);
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
            // Filter out TBU and other placeholders
            proposal: (qip.snapshotProposalId && 
                      qip.snapshotProposalId !== 'TBU' && 
                      qip.snapshotProposalId !== 'tbu' &&
                      qip.snapshotProposalId !== 'None') 
                      ? qip.snapshotProposalId 
                      : 'None',
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