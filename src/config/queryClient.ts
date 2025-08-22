import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

/**
 * Cache times configuration
 */
export const CACHE_TIMES = {
  // How long data is considered fresh (no background refetch)
  STALE_TIME: {
    QIP_LIST: 5 * 60 * 1000,        // 5 minutes - QIP list doesn't change often
    QIP_DETAIL: 10 * 60 * 1000,     // 10 minutes - Individual QIP data
    QIP_NUMBERS: 2 * 60 * 1000,     // 2 minutes - QIP numbers (for pagination)
    IPFS_CONTENT: 60 * 60 * 1000,   // 1 hour - IPFS content is immutable
    STATUS_FILTER: 5 * 60 * 1000,   // 5 minutes - Status filtered lists
  },
  
  // How long to keep data in cache (even if stale)
  GC_TIME: {
    QIP_LIST: 30 * 60 * 1000,       // 30 minutes
    QIP_DETAIL: 60 * 60 * 1000,     // 1 hour
    QIP_NUMBERS: 10 * 60 * 1000,    // 10 minutes
    IPFS_CONTENT: 24 * 60 * 60 * 1000, // 24 hours - IPFS is immutable
    STATUS_FILTER: 30 * 60 * 1000,  // 30 minutes
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
        staleTime: CACHE_TIMES.STALE_TIME.QIP_DETAIL,
        
        // Cache time: how long to keep data in cache
        gcTime: CACHE_TIMES.GC_TIME.QIP_DETAIL,
        
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
        
        // Keep previous data while fetching
        keepPreviousData: true,
      },
      mutations: {
        retry: 2,
        retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
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
    key: 'qips-query-cache',
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
      queryClient,
      persister,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours max age
      hydrateOptions: {
        // Don't hydrate queries older than 1 hour
        shouldDehydrateQuery: (query) => {
          const state = query.state;
          const isOld = Date.now() - state.dataUpdatedAt > 60 * 60 * 1000;
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
   * Prefetch a QIP detail
   */
  prefetchQIP: async (queryClient: QueryClient, qipNumber: number, fetcher: () => Promise<any>) => {
    await queryClient.prefetchQuery({
      queryKey: ['qip', qipNumber],
      queryFn: fetcher,
      staleTime: CACHE_TIMES.STALE_TIME.QIP_DETAIL,
      gcTime: CACHE_TIMES.GC_TIME.QIP_DETAIL,
    });
  },

  /**
   * Prefetch multiple QIPs
   */
  prefetchQIPs: async (queryClient: QueryClient, qipNumbers: number[], fetcher: (num: number) => Promise<any>) => {
    await Promise.all(
      qipNumbers.map(num => 
        prefetchHelpers.prefetchQIP(queryClient, num, () => fetcher(num))
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
   * Invalidate all QIP-related queries
   */
  invalidateAll: (queryClient: QueryClient) => {
    queryClient.invalidateQueries({ queryKey: ['qip'] });
    queryClient.invalidateQueries({ queryKey: ['qips'] });
    queryClient.invalidateQueries({ queryKey: ['qip-numbers'] });
  },

  /**
   * Invalidate a specific QIP
   */
  invalidateQIP: (queryClient: QueryClient, qipNumber: number) => {
    queryClient.invalidateQueries({ queryKey: ['qip', qipNumber] });
    // Also invalidate list queries as they might contain this QIP
    queryClient.invalidateQueries({ queryKey: ['qips'] });
  },

  /**
   * Smart invalidation based on QIP status change
   */
  invalidateOnStatusChange: (queryClient: QueryClient, qipNumber: number, newStatus: string) => {
    // Invalidate the specific QIP
    queryClient.invalidateQueries({ queryKey: ['qip', qipNumber] });
    // Invalidate status-filtered lists
    queryClient.invalidateQueries({ queryKey: ['qips', 'status'] });
    // Don't invalidate IPFS content as it's immutable
  },
};