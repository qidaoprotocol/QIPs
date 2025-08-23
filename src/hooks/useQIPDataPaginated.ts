import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QIPClient, QIPStatus } from '../services/qipClient';
import { getIPFSService } from '../services/getIPFSService';
import { QIPData } from './useQIPData';
import { config } from '../config/env';

interface UseQIPDataPaginatedOptions {
  registryAddress?: `0x${string}`;
  pageSize?: number;
  enabled?: boolean;
}

interface PaginatedQIPData {
  qips: QIPData[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  isLoading: boolean;
  isError: boolean;
  isFetchingMore: boolean;
  isRefetching: boolean;
  loadMore: () => Promise<void>;
  reset: () => void;
  invalidate: () => void;
}

/**
 * Paginated QIP data fetching hook
 * Fetches QIPs in batches to improve performance
 */
export function useQIPDataPaginated(options: UseQIPDataPaginatedOptions = {}): PaginatedQIPData {
  const {
    registryAddress,
    pageSize = 10,
    enabled = true,
  } = options;

  const queryClient = useQueryClient();
  
  // Pagination state cache key
  const paginationCacheKey = React.useMemo(
    () => ['qips-pagination-state', registryAddress],
    [registryAddress]
  );
  
  // Use a real query for pagination state to ensure it persists
  const { data: paginationState, isLoading: isPaginationStateLoading } = useQuery({
    queryKey: paginationCacheKey,
    queryFn: () => {
      // Check if we already have cached data
      const existing = queryClient.getQueryData<{
        loadedPages: number[];
        loadedQIPs: QIPData[];
        allQIPNumbers: bigint[];
      }>(paginationCacheKey);
      
      // Return existing state or defaults
      return existing || {
        loadedPages: [] as number[],
        loadedQIPs: [] as QIPData[],
        allQIPNumbers: [] as bigint[],
      };
    },
    staleTime: Infinity, // Never stale - we manage updates manually
    gcTime: 24 * 60 * 60 * 1000, // Keep for 24 hours
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Initialize state from the query data or defaults
  const [loadedPages, setLoadedPages] = useState<number[]>(() => paginationState?.loadedPages || []);
  const [allQIPNumbers, setAllQIPNumbers] = useState<bigint[]>(() => paginationState?.allQIPNumbers || []);
  const [loadedQIPs, setLoadedQIPs] = useState<QIPData[]>(() => paginationState?.loadedQIPs || []);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  
  // Sync state from query when it first loads with cached data
  const hasRestoredCache = React.useRef(false);
  React.useEffect(() => {
    if (!hasRestoredCache.current && paginationState && paginationState.loadedQIPs.length > 0) {
      hasRestoredCache.current = true;
      console.log(`[useQIPDataPaginated] Restoring cache with ${paginationState.loadedQIPs.length} QIPs, ${paginationState.loadedPages.length} pages`);
      
      // Deduplicate cached QIPs before restoring
      const uniqueQIPs = Array.from(
        new Map(paginationState.loadedQIPs.map((q: QIPData) => [q.qipNumber, q])).values()
      );
      
      setLoadedPages(paginationState.loadedPages);
      setAllQIPNumbers(paginationState.allQIPNumbers);
      setLoadedQIPs(uniqueQIPs);
    }
  }, [paginationState]);
  
  // Persist pagination state to query cache whenever it changes
  React.useEffect(() => {
    // Only update if we have actual data to persist
    if (loadedQIPs.length > 0 || allQIPNumbers.length > 0) {
      // Deduplicate before persisting to ensure clean cache
      const uniqueQIPs = Array.from(
        new Map(loadedQIPs.map(q => [q.qipNumber, q])).values()
      );
      
      queryClient.setQueryData(paginationCacheKey, {
        loadedPages,
        loadedQIPs: uniqueQIPs,
        allQIPNumbers,
      });
    }
  }, [loadedPages, loadedQIPs, allQIPNumbers, queryClient, paginationCacheKey]);

  // Initialize services (memoized to avoid recreating on every render)
  const qipClient = useMemo(() => 
    registryAddress 
      ? new QIPClient(registryAddress, config.baseRpcUrl, false)
      : null,
    [registryAddress]
  );

  const ipfsService = getIPFSService();

  // Step 1: Fetch all QIP numbers (lightweight)
  const { 
    data: qipNumbersData, 
    isLoading: isLoadingNumbers,
    isFetching: isFetchingNumbers,
    isError,
    refetch: refetchNumbers 
  } = useQuery({
    queryKey: ['qip-numbers', registryAddress],
    queryFn: async () => {
      if (!qipClient) return { numbers: [], total: 0 };

      console.log("[useQIPDataPaginated] Fetching all QIP numbers...");
      
      // Get all QIP numbers using multicall
      const statusMap = await qipClient.getAllQIPsByStatusBatch();
      
      // Collect unique QIP numbers
      const numbers = new Set<bigint>();
      for (const qipNumbers of statusMap.values()) {
        qipNumbers.forEach(n => numbers.add(n));
      }
      
      const sortedNumbers = Array.from(numbers).sort((a, b) => Number(b - a)); // Sort descending
      console.log(`[useQIPDataPaginated] Found ${sortedNumbers.length} QIPs total`);
      
      return {
        numbers: sortedNumbers,
        total: sortedNumbers.length
      };
    },
    enabled: enabled && !!registryAddress && !!qipClient,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  // Update state when QIP numbers are fetched
  React.useEffect(() => {
    if (qipNumbersData) {
      setAllQIPNumbers(qipNumbersData.numbers);
    }
  }, [qipNumbersData]);

  // Step 2: Fetch QIP details for current page
  const fetchQIPsForPage = useCallback(async (pageNum: number): Promise<QIPData[]> => {
    if (!qipClient || allQIPNumbers.length === 0) return [];

    const startIdx = pageNum * pageSize;
    const endIdx = Math.min(startIdx + pageSize, allQIPNumbers.length);
    const pageNumbers = allQIPNumbers.slice(startIdx, endIdx);

    if (pageNumbers.length === 0) return [];

    console.log(`[useQIPDataPaginated] Fetching page ${pageNum + 1} (QIPs ${startIdx + 1}-${endIdx})`);

    const qips: QIPData[] = [];
    
    // Batch fetch QIPs using multicall
    const BATCH_SIZE = 5;
    for (let i = 0; i < pageNumbers.length; i += BATCH_SIZE) {
      const batch = pageNumbers.slice(i, Math.min(i + BATCH_SIZE, pageNumbers.length));
      
      try {
        // Fetch blockchain data
        const batchQIPs = await qipClient.getQIPsBatch(batch);
        
        // Collect all IPFS CIDs for concurrent fetching
        const cidsToFetch = batchQIPs
          .filter(qip => qip && qip.qipNumber !== 0n && qip.ipfsUrl)
          .map(qip => qip.ipfsUrl.startsWith("ipfs://") ? qip.ipfsUrl.slice(7) : qip.ipfsUrl);
        
        // Fetch all IPFS content concurrently using rotating gateways
        console.debug(`[useQIPDataPaginated] Fetching ${cidsToFetch.length} QIPs from IPFS concurrently`);
        const ipfsContents = await ipfsService.fetchMultipleQIPs(cidsToFetch);
        
        // Process each QIP with its IPFS content
        for (const qip of batchQIPs) {
          if (!qip || qip.qipNumber === 0n) continue;
          
          try {
            const cid = qip.ipfsUrl.startsWith("ipfs://") ? qip.ipfsUrl.slice(7) : qip.ipfsUrl;
            const ipfsContent = ipfsContents.get(cid);
            
            if (!ipfsContent) {
              console.warn(`[useQIPDataPaginated] No IPFS content found for QIP ${qip.qipNumber}, CID: ${cid}`);
              continue;
            }
            
            const { frontmatter, content } = ipfsService.parseQIPMarkdown(ipfsContent);

            const implDate = qip.implementationDate > 0n 
              ? new Date(Number(qip.implementationDate) * 1000).toISOString().split("T")[0] 
              : "None";

            const statusString = qipClient.getStatusString(qip.status);
            console.debug(`[useQIPDataPaginated] QIP ${qip.qipNumber} - Status: ${qip.status} -> ${statusString}`);
            
            const qipData: QIPData = {
              qipNumber: Number(qip.qipNumber),
              title: qip.title,
              network: qip.network,
              status: statusString, // On-chain status (source of truth)
              statusEnum: qip.status, // Include the enum value
              ipfsStatus: frontmatter.status, // Status from IPFS (may differ)
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
            };
            
            // Cache this QIP data for the individual QIP hook to use
            queryClient.setQueryData(
              ['qip', Number(qip.qipNumber), registryAddress],
              qipData,
              { updatedAt: Date.now() }
            );
            
            // Also cache the blockchain data separately
            queryClient.setQueryData(
              ['qip-blockchain', Number(qip.qipNumber), registryAddress],
              qip,
              { updatedAt: Date.now() }
            );
            
            // Cache IPFS content separately
            queryClient.setQueryData(['ipfs', qip.ipfsUrl], {
              raw: ipfsContent,
              frontmatter,
              body: content,
              cid: qip.ipfsUrl,
            }, { updatedAt: Date.now() });
            
            qips.push(qipData);
          } catch (error) {
            console.error(`[useQIPDataPaginated] Error processing QIP ${qip.qipNumber}:`, error);
          }
        }
        
        // Small delay between batches (reduced since IPFS is now concurrent)
        if (i + BATCH_SIZE < pageNumbers.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`[useQIPDataPaginated] Error fetching batch:`, error);
      }
    }

    return qips;
  }, [qipClient, allQIPNumbers, pageSize, ipfsService]);

  // Load initial page - only if we don't have cached data
  const shouldLoadInitialPage = enabled && !!qipClient && allQIPNumbers.length > 0 && 
                                 (!paginationState || paginationState.loadedQIPs.length === 0);
  
  const { data: initialQIPs, isLoading: isLoadingInitial, isFetching: isFetchingInitial } = useQuery({
    queryKey: ['qips-page', registryAddress, 0, pageSize],
    queryFn: () => fetchQIPsForPage(0),
    enabled: shouldLoadInitialPage,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  // Update loaded QIPs when initial page loads (only if we're starting fresh)
  React.useEffect(() => {
    if (initialQIPs && initialQIPs.length > 0 && !loadedPages.includes(0)) {
      // Only process if page 0 hasn't been loaded yet
      setLoadedPages([0]);
      setLoadedQIPs(initialQIPs);
    }
  }, [initialQIPs]); // Removed loadedPages dependency to prevent re-runs

  // Load more function
  const loadMore = useCallback(async () => {
    if (isFetchingMore || !qipClient || allQIPNumbers.length === 0) return;
    
    // Calculate the next page based on current loaded pages
    const nextPage = loadedPages.length;
    
    const startIdx = nextPage * pageSize;
    if (startIdx >= allQIPNumbers.length) {
      console.log(`[useQIPDataPaginated] No more pages to load (startIdx: ${startIdx}, total: ${allQIPNumbers.length})`);
      return;
    }

    console.log(`[useQIPDataPaginated] Loading page ${nextPage} (QIPs ${startIdx}-${Math.min(startIdx + pageSize - 1, allQIPNumbers.length - 1)})`);
    setIsFetchingMore(true);
    
    try {
      const nextPageQIPs = await fetchQIPsForPage(nextPage);
      
      if (nextPageQIPs.length > 0) {
        // Use functional update to ensure we have the latest state
        setLoadedQIPs(prev => {
          const existingNumbers = new Set(prev.map(q => q.qipNumber));
          const newQIPs = nextPageQIPs.filter(q => !existingNumbers.has(q.qipNumber));
          
          if (newQIPs.length === 0) {
            console.warn(`[useQIPDataPaginated] All QIPs from page ${nextPage} were duplicates`);
            return prev;
          }
          
          console.log(`[useQIPDataPaginated] Adding ${newQIPs.length} new QIPs from page ${nextPage}`);
          return [...prev, ...newQIPs];
        });
        
        setLoadedPages(prev => [...prev, nextPage]);
      }
    } catch (error) {
      console.error('[useQIPDataPaginated] Error loading more:', error);
    } finally {
      setIsFetchingMore(false);
    }
  }, [loadedPages.length, pageSize, allQIPNumbers.length, isFetchingMore, qipClient, fetchQIPsForPage]);

  // Reset pagination
  const reset = useCallback(() => {
    setLoadedPages([]);
    setLoadedQIPs([]);
    setAllQIPNumbers([]);
    // Reset the pagination state query
    queryClient.setQueryData(paginationCacheKey, {
      loadedPages: [],
      loadedQIPs: [],
      allQIPNumbers: [],
    });
    queryClient.invalidateQueries({ queryKey: ['qips-page'] });
  }, [queryClient, paginationCacheKey]);

  // Invalidate all data
  const invalidate = useCallback(() => {
    reset();
    refetchNumbers();
  }, [reset, refetchNumbers]);

  // Calculate pagination info
  const totalCount = allQIPNumbers.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const currentPage = loadedPages.length;
  const hasMore = currentPage * pageSize < totalCount;

  // Determine loading state intelligently
  // Show loading if:
  // 1. We're still checking for cached pagination state, OR
  // 2. We're loading QIP numbers for the first time, OR  
  // 3. We're loading the initial page and haven't loaded any QIPs yet
  const hasCachedData = paginationState?.loadedQIPs?.length > 0;
  const hasLoadedData = loadedQIPs.length > 0;
  
  // Only show loading on true first load (no cache, no data)
  const isActuallyLoading = (
    isPaginationStateLoading || // Still checking for cache
    isLoadingNumbers || // Loading QIP numbers
    (isLoadingInitial && !hasLoadedData && !hasCachedData) // Loading initial page with no data
  );
  
  return {
    qips: loadedQIPs,
    totalCount,
    currentPage: currentPage + 1, // 1-indexed for display
    totalPages,
    hasMore,
    isLoading: isActuallyLoading,
    isError,
    isFetchingMore,
    isRefetching: isFetchingNumbers || isFetchingInitial, // New field for background refetches
    loadMore,
    reset,
    invalidate,
  };
}