import React, { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QIPClient, QIPStatus } from '../services/qipClient';
import { getIPFSService } from '../services/getIPFSService';
import { QIPData } from './useQIPData';
import { config } from '../config/env';
import { queryKeys, queryKeyPatterns } from '../utils/queryKeys';

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
    () => queryKeys.qipsPaginationState(registryAddress),
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

  // Initialize services - Create client synchronously to avoid enabled condition transitions
  // This prevents the query from transitioning from disabled→enabled which forces a refetch
  const qipClient = registryAddress 
    ? new QIPClient(registryAddress, config.baseRpcUrl, false)
    : null;

  const ipfsService = getIPFSService();

  // Step 1: Fetch all QIP numbers (lightweight)
  const { 
    data: qipNumbersData, 
    isLoading: isLoadingNumbers,
    isFetching: isFetchingNumbers,
    isError,
    refetch: refetchNumbers 
  } = useQuery({
    queryKey: queryKeys.qipNumbers(registryAddress),
    queryFn: async () => {
      if (!qipClient) {
        console.log("[useQIPDataPaginated] ❌ No QIP client available");
        return { numbers: [], total: 0 };
      }

      // Check if we already have cached data that's still fresh
      const cachedData = queryClient.getQueryData<{ numbers: bigint[]; total: number }>(
        queryKeys.qipNumbers(registryAddress)
      );
      if (cachedData) {
        console.log("[useQIPDataPaginated] ✅ Using cached QIP numbers, skipping discovery phase");
        return cachedData;
      }

      console.log("[useQIPDataPaginated] 🔍 Starting QIP discovery phase...");
      console.log("[useQIPDataPaginated] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      
      // Get the next QIP number (highest + 1)
      console.log("[useQIPDataPaginated] 📊 Fetching nextQIPNumber from contract...");
      
      let nextQIPNumber: bigint;
      try {
        nextQIPNumber = await qipClient.getNextQIPNumber();
        console.log(`[useQIPDataPaginated] ✅ nextQIPNumber: ${nextQIPNumber}`);
      } catch (error) {
        console.error("[useQIPDataPaginated] ❌ Failed to fetch nextQIPNumber:", error);
        console.log("[useQIPDataPaginated] 🔧 Using fallback value: 248");
        nextQIPNumber = 248n;
      }
      
      // Known minimum QIP number (where migration started)
      const MIN_QIP_NUMBER = 209n;
      const maxQIP = nextQIPNumber > 0n ? nextQIPNumber - 1n : 247n;
      
      console.log(`[useQIPDataPaginated] 📋 QIP Range: ${MIN_QIP_NUMBER} to ${maxQIP}`);
      console.log(`[useQIPDataPaginated] 📦 Total slots to check: ${Number(maxQIP - MIN_QIP_NUMBER + 1n)}`);
      
      // Discovery: Find which QIPs actually exist
      const existingNumbers: bigint[] = [];
      const DISCOVERY_BATCH_SIZE = 5; // Reduced from 10 to avoid rate limits
      let checkedCount = 0;
      let foundCount = 0;
      let batchNumber = 0;
      const totalBatches = Math.ceil(Number(maxQIP - MIN_QIP_NUMBER + 1n) / DISCOVERY_BATCH_SIZE);
      
      console.log(`[useQIPDataPaginated] 🔎 Discovering existing QIPs in batches of ${DISCOVERY_BATCH_SIZE}...`);
      console.log(`[useQIPDataPaginated]    Total batches to check: ${totalBatches}`);
      
      for (let i = MIN_QIP_NUMBER; i <= maxQIP; i += BigInt(DISCOVERY_BATCH_SIZE)) {
        const batchEnd = i + BigInt(DISCOVERY_BATCH_SIZE - 1) > maxQIP ? maxQIP : i + BigInt(DISCOVERY_BATCH_SIZE - 1);
        const batchNumbers: bigint[] = [];
        batchNumber++;
        
        for (let j = i; j <= batchEnd; j++) {
          batchNumbers.push(j);
        }
        
        console.log(`[useQIPDataPaginated] 📡 Batch ${batchNumber}/${totalBatches}: Checking QIP ${i} to ${batchEnd} (${batchNumbers.length} items)`);
        
        // Add delay between batches to avoid rate limiting (except for first batch)
        if (batchNumber > 1) {
          const delay = Math.min(200 * batchNumber, 1000); // Progressive delay, max 1 second
          console.log(`[useQIPDataPaginated]    ⏱️ Waiting ${delay}ms to avoid rate limits...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        try {
          // Fetch batch to see which QIPs exist
          const batchQIPs = await qipClient.getQIPsBatch(batchNumbers);
          const foundInBatch = batchQIPs.filter(qip => qip && qip.qipNumber > 0n).length;
          
          console.log(`[useQIPDataPaginated]    ├─ Found: ${foundInBatch}/${batchNumbers.length} QIPs exist`);
          
          // Process found QIPs and start prefetching
          const prefetchPromises: Promise<void>[] = [];
          
          for (const qip of batchQIPs) {
            if (qip && qip.qipNumber > 0n) {
              existingNumbers.push(qip.qipNumber);
              console.log(`[useQIPDataPaginated]    ├─ ✓ QIP-${qip.qipNumber}: "${qip.title}"`);
              foundCount++;
              
              // Cache the blockchain data immediately
              queryClient.setQueryData(
                queryKeys.qipBlockchain(Number(qip.qipNumber), registryAddress),
                qip,
                { updatedAt: Date.now() }
              );
              
              // Prefetch IPFS content AND assemble full QIP data
              if (qip.ipfsUrl) {
                const prefetchPromise = (async () => {
                  try {
                    // Check if IPFS is already cached
                    let ipfsData = queryClient.getQueryData<any>(queryKeys.ipfs(qip.ipfsUrl));
                    
                    if (!ipfsData) {
                      console.log(`[useQIPDataPaginated]    │  └─ 🌐 Pre-fetching IPFS for QIP-${qip.qipNumber}`);
                      const content = await ipfsService.fetchQIP(qip.ipfsUrl);
                      const parsed = ipfsService.parseQIPMarkdown(content);
                      ipfsData = { raw: content, ...parsed, cid: qip.ipfsUrl };
                      
                      // Cache the IPFS content
                      queryClient.setQueryData(queryKeys.ipfs(qip.ipfsUrl), ipfsData, {
                        updatedAt: Date.now(),
                      });
                    }
                    
                    // Now assemble and cache the full QIP data
                    if (ipfsData) {
                      const { frontmatter, content } = ipfsData;
                      const implDate = qip.implementationDate > 0n 
                        ? new Date(Number(qip.implementationDate) * 1000).toISOString().split('T')[0]
                        : 'None';
                      
                      const fullQIPData: QIPData = {
                        qipNumber: Number(qip.qipNumber),
                        title: qip.title,
                        network: qip.network,
                        status: qipClient.getStatusString(qip.status),
                        statusEnum: qip.status,
                        ipfsStatus: frontmatter?.status,
                        author: frontmatter?.author || qip.author,
                        implementor: qip.implementor,
                        implementationDate: implDate,
                        proposal: (qip.snapshotProposalId && 
                                  qip.snapshotProposalId !== 'TBU' && 
                                  qip.snapshotProposalId !== 'tbu' &&
                                  qip.snapshotProposalId !== 'None') 
                                  ? qip.snapshotProposalId 
                                  : 'None',
                        created: frontmatter?.created || new Date(Number(qip.createdAt) * 1000).toISOString().split('T')[0],
                        content: content || ipfsData.body || '',
                        ipfsUrl: qip.ipfsUrl,
                        contentHash: qip.contentHash,
                        version: Number(qip.version),
                        source: 'blockchain' as const,
                        lastUpdated: Date.now()
                      };
                      
                      // Cache the full QIP data for instant access when navigating
                      queryClient.setQueryData(
                        queryKeys.qip(Number(qip.qipNumber), registryAddress),
                        fullQIPData,
                        { updatedAt: Date.now() }
                      );
                      
                      console.log(`[useQIPDataPaginated]    │  └─ ✅ Cached full QIP-${qip.qipNumber} data`);
                    }
                  } catch (error) {
                    console.warn(`[useQIPDataPaginated]    │  └─ ⚠️ Pre-fetch failed for QIP-${qip.qipNumber}:`, error);
                  }
                })();
                
                prefetchPromises.push(prefetchPromise);
              }
            }
          }
          
          // Start all IPFS prefetches in parallel, but don't wait for them
          Promise.all(prefetchPromises).then(() => {
            console.log(`[useQIPDataPaginated]    ├─ 🚀 Prefetched IPFS for ${prefetchPromises.length} QIPs`);
          }).catch(err => {
            console.warn(`[useQIPDataPaginated]    ├─ ⚠️ Some IPFS prefetches failed:`, err);
          });
          
          checkedCount += batchNumbers.length;
          
          // Add non-existent QIPs to log
          const foundNumbers = new Set(batchQIPs.map(q => q.qipNumber));
          const missing = batchNumbers.filter(n => !foundNumbers.has(n));
          if (missing.length > 0) {
            console.log(`[useQIPDataPaginated]    └─ ✗ Missing: ${missing.join(', ')}`);
          }
          
        } catch (error) {
          console.error(`[useQIPDataPaginated] ❌ Error fetching batch ${i}-${batchEnd}:`, error);
        }
      }
      
      // Sort descending (newest first)
      const sortedNumbers = existingNumbers.sort((a, b) => Number(b - a));
      
      console.log("[useQIPDataPaginated] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[useQIPDataPaginated] 📊 Discovery Complete:`);
      console.log(`[useQIPDataPaginated]    ├─ Slots checked: ${checkedCount}`);
      console.log(`[useQIPDataPaginated]    ├─ QIPs found: ${foundCount}`);
      console.log(`[useQIPDataPaginated]    ├─ Missing: ${checkedCount - foundCount}`);
      console.log(`[useQIPDataPaginated]    └─ QIP numbers: [${sortedNumbers.slice(0, 5).join(', ')}${sortedNumbers.length > 5 ? ', ...' : ''}]`);
      console.log("[useQIPDataPaginated] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      
      return {
        numbers: sortedNumbers,
        total: sortedNumbers.length
      };
    },
    // Simplified enabled condition - qipClient is derived from registryAddress
    enabled: enabled && !!registryAddress,
    staleTime: 10 * 60 * 1000, // 10 minutes (matching QIP detail queries)
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnMount: false, // Don't refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnReconnect: false, // Don't refetch on reconnect
  });

  // Update state when QIP numbers are fetched
  React.useEffect(() => {
    if (qipNumbersData) {
      setAllQIPNumbers(qipNumbersData.numbers);
    }
  }, [qipNumbersData]);

  // Step 2: Fetch QIP details for current page
  const fetchQIPsForPage = useCallback(async (pageNum: number): Promise<QIPData[]> => {
    if (!qipClient || allQIPNumbers.length === 0) {
      console.log("[useQIPDataPaginated] ⚠️ Cannot fetch page - no client or no QIP numbers");
      return [];
    }

    const startIdx = pageNum * pageSize;
    const endIdx = Math.min(startIdx + pageSize, allQIPNumbers.length);
    const pageNumbers = allQIPNumbers.slice(startIdx, endIdx);

    if (pageNumbers.length === 0) {
      console.log(`[useQIPDataPaginated] ⚠️ Page ${pageNum + 1} has no QIP numbers`);
      return [];
    }

    console.log("[useQIPDataPaginated] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[useQIPDataPaginated] 📄 Fetching Page ${pageNum + 1}`);
    console.log(`[useQIPDataPaginated]    ├─ Index range: ${startIdx + 1}-${endIdx} of ${allQIPNumbers.length} total`);
    console.log(`[useQIPDataPaginated]    ├─ QIP numbers: [${pageNumbers.join(', ')}]`);
    console.log(`[useQIPDataPaginated]    └─ Items on page: ${pageNumbers.length}`);

    const qips: QIPData[] = [];
    
    console.log(`[useQIPDataPaginated] 🔄 Starting batch fetch process...`);
    
    // Batch fetch QIPs using multicall
    const BATCH_SIZE = 5;
    for (let i = 0; i < pageNumbers.length; i += BATCH_SIZE) {
      const batch = pageNumbers.slice(i, Math.min(i + BATCH_SIZE, pageNumbers.length));
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pageNumbers.length / BATCH_SIZE);
      
      console.log(`[useQIPDataPaginated] 📦 Batch ${batchNum}/${totalBatches}: QIPs [${batch.join(', ')}]`);
      
      try {
        // Check cache first, then fetch missing data
        console.log(`[useQIPDataPaginated]    ├─ 📋 Checking cache for ${batch.length} QIPs...`);
        
        const qipsToFetch: bigint[] = [];
        const cachedQIPs: any[] = [];
        
        // Check what's already cached
        for (const qipNumber of batch) {
          const cached = queryClient.getQueryData(queryKeys.qipBlockchain(Number(qipNumber), registryAddress));
          if (cached) {
            cachedQIPs.push(cached);
            console.log(`[useQIPDataPaginated]    │  ├─ ✅ Cache hit: QIP-${qipNumber}`);
          } else {
            qipsToFetch.push(qipNumber);
            console.log(`[useQIPDataPaginated]    │  ├─ ❌ Cache miss: QIP-${qipNumber}`);
          }
        }
        
        // Fetch missing blockchain data
        let batchQIPs = cachedQIPs;
        if (qipsToFetch.length > 0) {
          console.log(`[useQIPDataPaginated]    ├─ 🔗 Fetching ${qipsToFetch.length} missing QIPs from blockchain...`);
          const freshQIPs = await qipClient.getQIPsBatch(qipsToFetch);
          batchQIPs = [...cachedQIPs, ...freshQIPs];
          
          // Cache the fresh data
          for (const qip of freshQIPs) {
            if (qip && qip.qipNumber > 0n) {
              queryClient.setQueryData(
                queryKeys.qipBlockchain(Number(qip.qipNumber), registryAddress),
                qip,
                { updatedAt: Date.now() }
              );
            }
          }
        }
        console.log(`[useQIPDataPaginated]    ├─ ✅ Got ${batchQIPs.length} QIPs (${cachedQIPs.length} cached, ${qipsToFetch.length} fetched)`);
        
        // Start IPFS fetches immediately and in parallel
        const ipfsPromises = batchQIPs
          .filter(qip => qip && qip.qipNumber !== 0n && qip.ipfsUrl)
          .map(async (qip) => {
            const cid = qip.ipfsUrl.startsWith("ipfs://") ? qip.ipfsUrl.slice(7) : qip.ipfsUrl;
            
            // Check cache first
            const cached = queryClient.getQueryData(queryKeys.ipfs(qip.ipfsUrl));
            if (cached) {
              console.log(`[useQIPDataPaginated]    │  ├─ ✅ IPFS cache hit: QIP-${qip.qipNumber}`);
              return { qip, ipfsContent: cached };
            }
            
            // Fetch if not cached
            try {
              console.log(`[useQIPDataPaginated]    │  ├─ 🌐 Fetching IPFS: QIP-${qip.qipNumber}`);
              const content = await ipfsService.fetchQIP(qip.ipfsUrl);
              const parsed = ipfsService.parseQIPMarkdown(content);
              const ipfsData = { raw: content, ...parsed, cid: qip.ipfsUrl };
              
              // Cache the IPFS content
              queryClient.setQueryData(queryKeys.ipfs(qip.ipfsUrl), ipfsData, {
                updatedAt: Date.now(),
                staleTime: Infinity,
              });
              
              return { qip, ipfsContent: ipfsData };
            } catch (error) {
              console.warn(`[useQIPDataPaginated]    │  ├─ ⚠️ IPFS fetch failed: QIP-${qip.qipNumber}`, error);
              return { qip, ipfsContent: null };
            }
          });
        
        // Wait for all IPFS fetches to complete in parallel
        const ipfsResults = await Promise.all(ipfsPromises);
        console.log(`[useQIPDataPaginated]    ├─ ✅ Got ${ipfsResults.filter(r => r.ipfsContent).length} IPFS responses`);
        
        // Process each QIP with its IPFS content
        console.log(`[useQIPDataPaginated]    ├─ 📝 Processing ${ipfsResults.length} QIPs...`);
        let processedCount = 0;
        let skippedCount = 0;
        
        for (const { qip, ipfsContent } of ipfsResults) {
          if (!qip || qip.qipNumber === 0n) {
            console.log(`[useQIPDataPaginated]       ├─ ⚠️ Skipping empty QIP slot`);
            skippedCount++;
            continue;
          }
          
          if (!ipfsContent) {
            console.warn(`[useQIPDataPaginated]       ├─ ⚠️ QIP-${qip.qipNumber}: No IPFS content`);
            skippedCount++;
            continue;
          }
          
          try {
            const { frontmatter, body: content } = ipfsContent;

            const implDate = qip.implementationDate > 0n 
              ? new Date(Number(qip.implementationDate) * 1000).toISOString().split("T")[0] 
              : "None";

            const statusString = qipClient.getStatusString(qip.status);
            
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
              queryKeys.qip(Number(qip.qipNumber), registryAddress),
              qipData,
              { updatedAt: Date.now() }
            );
            
            // Blockchain and IPFS data are already cached from earlier
            
            qips.push(qipData);
            processedCount++;
            console.log(`[useQIPDataPaginated]       ├─ ✅ QIP-${qip.qipNumber}: "${qip.title}" (${statusString})`);
          } catch (error) {
            console.error(`[useQIPDataPaginated]       ├─ ❌ QIP-${qip.qipNumber}: Processing failed:`, error);
            skippedCount++;
          }
        }
        
        console.log(`[useQIPDataPaginated]    └─ Batch complete: ${processedCount} processed, ${skippedCount} skipped`);
        
        // Small delay between batches (reduced since IPFS is now concurrent)
        if (i + BATCH_SIZE < pageNumbers.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`[useQIPDataPaginated] ❌ Batch ${batchNum} failed:`, error);
        console.error(`[useQIPDataPaginated]    └─ Error details:`, error);
      }
    }

    console.log("[useQIPDataPaginated] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[useQIPDataPaginated] ✅ Page Complete`);
    console.log(`[useQIPDataPaginated]    └─ Successfully loaded: ${qips.length} QIPs`);
    console.log("[useQIPDataPaginated] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return qips;
  }, [qipClient, allQIPNumbers, pageSize, ipfsService]);

  // Load initial page - only if we don't have cached data
  const shouldLoadInitialPage = enabled && !!qipClient && allQIPNumbers.length > 0 && 
                                 (!paginationState || paginationState.loadedQIPs.length === 0);
  
  const { data: initialQIPs, isLoading: isLoadingInitial, isFetching: isFetchingInitial } = useQuery({
    queryKey: queryKeys.qipsPage(registryAddress, 0, pageSize),
    queryFn: () => fetchQIPsForPage(0),
    enabled: shouldLoadInitialPage,
    staleTime: 10 * 60 * 1000, // 10 minutes (consistent with QIP numbers)
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnMount: false, // Don't refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus
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
    queryClient.invalidateQueries({ queryKey: queryKeyPatterns.allPages });
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