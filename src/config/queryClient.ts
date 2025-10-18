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
 * Clear QCI-related cache on fresh page load (browser refresh)
 * Preserves IPFS and other valuable cached data
 */
export function clearQCICacheOnFreshLoad() {
  // Check if this is a fresh page load (browser refresh, new tab, etc.)
  if (typeof window === 'undefined') return;

  // Use performance.navigation API or navigation.type to detect page refresh
  // Type 1 = reload, Type 0 = navigation
  const isPageReload = (
    (window.performance && window.performance.navigation && window.performance.navigation.type === 1) ||
    (window.performance && (window.performance as any).getEntriesByType &&
     (window.performance as any).getEntriesByType('navigation')[0] &&
     (window.performance as any).getEntriesByType('navigation')[0].type === 'reload')
  );

  // Also check if this is the first load in this React app instance
  // We use a window property that React Router won't persist
  const isFirstLoad = !(window as any).__qcis_app_loaded;

  if (isPageReload || isFirstLoad) {
    try {
      console.log('[Cache] Detected fresh page load (reload:', isPageReload, ', first load:', isFirstLoad, ')');

      const cacheKey = 'qcis-query-cache';
      const cachedData = localStorage.getItem(cacheKey);

      if (cachedData) {
        const parsed = JSON.parse(cachedData);

        if (parsed.clientState && parsed.clientState.queries) {
          const originalCount = parsed.clientState.queries.length;

          parsed.clientState.queries = parsed.clientState.queries.filter((query: any) => {
            const queryKey = query.queryKey;
            if (!Array.isArray(queryKey) || queryKey.length === 0) return true;

            const firstKey = queryKey[0];

            if (firstKey === 'qci' ||
                firstKey === 'qcis' ||
                firstKey === 'qci-numbers' ||
                firstKey === 'qci-blockchain' ||
                firstKey === 'qci-versions') {
              console.log('[Cache] Clearing stale QCI query:', queryKey);
              return false;
            }

            return true;
          });

          const removedCount = originalCount - parsed.clientState.queries.length;
          console.log(`[Cache] Cleared ${removedCount} QCI queries, preserved ${parsed.clientState.queries.length} other queries`);
        }

        localStorage.setItem(cacheKey, JSON.stringify(parsed));
        console.log('[Cache] Successfully cleared QCI queries on fresh page load');
      }

      // Mark that the app has loaded
      (window as any).__qcis_app_loaded = true;
    } catch (error) {
      console.error('[Cache] Error clearing QCI cache:', error);
      localStorage.removeItem('qcis-query-cache');
    }
  } else {
    console.log('[Cache] Internal navigation detected, preserving all cache');
  }
}

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