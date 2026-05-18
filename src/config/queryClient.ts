import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

/**
 * Cache times configuration
 */
export const CACHE_TIMES = {
  // How long data is considered fresh (no background refetch)
  STALE_TIME: {
    QCI_LIST: 5 * 60 * 1000,        // 5 minutes - QCI list doesn't change often
    QCI_DETAIL: 10 * 60 * 1000,     // 10 minutes - Individual QCI data
    QCI_NUMBERS: 2 * 60 * 1000,     // 2 minutes - QCI numbers (for pagination)
    IPFS_CONTENT: 60 * 60 * 1000,   // 1 hour - IPFS content is immutable
    STATUS_FILTER: 5 * 60 * 1000,   // 5 minutes - Status filtered lists
    CONTRACT_ABI: 24 * 60 * 60 * 1000, // 24 hours - Contract ABIs are immutable
    CONTRACT_HISTORY: Infinity,     // Never expire - user's local data
  },

  // How long to keep data in cache (even if stale)
  GC_TIME: {
    QCI_LIST: 30 * 60 * 1000,       // 30 minutes
    QCI_DETAIL: 60 * 60 * 1000,     // 1 hour
    QCI_NUMBERS: 10 * 60 * 1000,    // 10 minutes
    IPFS_CONTENT: 24 * 60 * 60 * 1000, // 24 hours - IPFS is immutable
    STATUS_FILTER: 30 * 60 * 1000,  // 30 minutes
    CONTRACT_ABI: 7 * 24 * 60 * 60 * 1000, // 7 days - Contract ABIs don't change
    CONTRACT_HISTORY: Infinity,     // Never garbage collect - user's local data
  }
};

/**
 * Create and configure the query client with optimized caching
 */
export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Stale time: how long until data is considered stale
        staleTime: CACHE_TIMES.STALE_TIME.QCI_DETAIL,
        
        // Cache time: how long to keep data in cache
        gcTime: CACHE_TIMES.GC_TIME.QCI_DETAIL,
        
        // Retry configuration
        retry: (failureCount, error: any) => {
          // Don't retry on 404s
          if (error?.status === 404) return false;
          // Retry up to 3 times with exponential backoff
          return failureCount < 3;
        },
        retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
        
        // Background refetch
        refetchOnWindowFocus: false, // Don't refetch on window focus
        refetchOnReconnect: 'always', // Refetch when reconnecting
        
        // Keep previous data while fetching (replaced with placeholderData in v5)
        placeholderData: (previousData: any) => previousData,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return queryClient;
}

/**
 * Create persister for localStorage caching
 */
export function createPersister() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return createSyncStoragePersister({
    storage: window.localStorage,
    key: 'qcis-query-cache',
    throttleTime: 1000, // Throttle writes to localStorage
  });
}

/**
 * Setup persistent caching
 */
export function setupPersistentCache(queryClient: QueryClient) {
  const persister = createPersister();
  
  if (persister) {
    persistQueryClient({
      queryClient: queryClient as any,
      persister,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours max age
      dehydrateOptions: {
        // Persist long-lived queries more aggressively
        shouldDehydrateQuery: (query: any) => {
          const state = query.state;
          const queryKey = query.queryKey;

          // ALWAYS persist status queries (they're quasi-static)
          if (Array.isArray(queryKey) && queryKey[0] === 'statuses') {
            return true;
          }

          // ALWAYS persist IPFS content (it's immutable)
          if (Array.isArray(queryKey) && queryKey[0] === 'ipfs') {
            return true;
          }

          // ALWAYS persist contract ABIs (they're immutable)
          if (Array.isArray(queryKey) && queryKey[0] === 'contract-abi') {
            return true;
          }

          // ALWAYS persist contract history (user's local data)
          if (Array.isArray(queryKey) && queryKey[0] === 'contract-history') {
            return true;
          }

          // For other queries, only persist if updated within last 2 hours
          const isOld = Date.now() - state.dataUpdatedAt > 2 * 60 * 60 * 1000;
          return !isOld;
        },
      },
    });
  }
}

/**
 * Prefetch helpers
 */
export const prefetchHelpers = {
  /**
   * Prefetch a QCI detail
   */
  prefetchQCI: async (queryClient: QueryClient, qciNumber: number, fetcher: () => Promise<any>) => {
    await queryClient.prefetchQuery({
      queryKey: ['qci', qciNumber],
      queryFn: fetcher,
      staleTime: CACHE_TIMES.STALE_TIME.QCI_DETAIL,
      gcTime: CACHE_TIMES.GC_TIME.QCI_DETAIL,
    });
  },

  /**
   * Prefetch multiple QCIs
   */
  prefetchQCIs: async (queryClient: QueryClient, qciNumbers: number[], fetcher: (num: number) => Promise<any>) => {
    await Promise.all(
      qciNumbers.map(num => 
        prefetchHelpers.prefetchQCI(queryClient, num, () => fetcher(num))
      )
    );
  },

  /**
   * Prefetch IPFS content
   */
  prefetchIPFS: async (queryClient: QueryClient, cid: string, fetcher: () => Promise<any>) => {
    await queryClient.prefetchQuery({
      queryKey: ['ipfs', cid],
      queryFn: fetcher,
      staleTime: CACHE_TIMES.STALE_TIME.IPFS_CONTENT,
      gcTime: CACHE_TIMES.GC_TIME.IPFS_CONTENT,
    });
  },
};

/**
 * Cache invalidation helpers
 */
export const cacheInvalidation = {
  /**
   * Invalidate all QCI-related queries
   */
  invalidateAll: (queryClient: QueryClient) => {
    queryClient.invalidateQueries({ queryKey: ['qci'] });
    queryClient.invalidateQueries({ queryKey: ['qcis'] });
    queryClient.invalidateQueries({ queryKey: ['qci-numbers'] });
  },

  /**
   * Invalidate a specific QCI
   */
  invalidateQCI: (queryClient: QueryClient, qciNumber: number) => {
    queryClient.invalidateQueries({ queryKey: ['qci', qciNumber] });
    // Also invalidate list queries as they might contain this QCI
    queryClient.invalidateQueries({ queryKey: ['qcis'] });
  },

  /**
   * Smart invalidation based on QCI status change
   */
  invalidateOnStatusChange: (queryClient: QueryClient, qciNumber: number, newStatus: string) => {
    // Invalidate the specific QCI
    queryClient.invalidateQueries({ queryKey: ['qci', qciNumber] });
    // Invalidate status-filtered lists
    queryClient.invalidateQueries({ queryKey: ['qcis', 'status'] });
    // Don't invalidate IPFS content as it's immutable
  },
};