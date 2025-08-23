import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getIPFSService } from '../services/getIPFSService';
import { CACHE_TIMES } from '../config/queryClient';

interface UseIPFSOptions {
  enabled?: boolean;
  onSuccess?: (data: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for fetching and caching IPFS content
 * IPFS content is immutable, so we can cache it aggressively
 */
export function useCachedIPFS(cid: string | undefined, options: UseIPFSOptions = {}) {
  const ipfsService = getIPFSService();
  
  const query = useQuery({
    queryKey: ['ipfs', cid],
    queryFn: async () => {
      if (!cid) throw new Error('No CID provided');
      
      console.debug(`[useCachedIPFS] Fetching CID: ${cid}`);
      const content = await ipfsService.fetchQIP(cid);
      
      // Parse the content to validate it
      const { frontmatter, content: body } = ipfsService.parseQIPMarkdown(content);
      
      return {
        raw: content,
        frontmatter,
        body,
        cid,
      };
    },
    enabled: !!cid && options.enabled !== false,
    staleTime: CACHE_TIMES.STALE_TIME.IPFS_CONTENT, // 1 hour
    gcTime: CACHE_TIMES.GC_TIME.IPFS_CONTENT, // 24 hours
    retry: 3,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Handle success/error callbacks with useEffect (TanStack Query v5 pattern)
  useEffect(() => {
    if (query.isSuccess && query.data) {
      console.debug(`[useCachedIPFS] Successfully cached CID: ${cid}`);
      options.onSuccess?.(query.data.raw);
    }
  }, [query.isSuccess, query.data, cid, options.onSuccess]);

  useEffect(() => {
    if (query.isError && query.error) {
      console.error(`[useCachedIPFS] Error fetching CID ${cid}:`, query.error);
      options.onError?.(query.error as Error);
    }
  }, [query.isError, query.error, cid, options.onError]);

  return query;
}

/**
 * Hook to prefetch multiple IPFS CIDs
 */
export function useIPFSPrefetch() {
  const queryClient = useQueryClient();
  const ipfsService = getIPFSService();
  
  const prefetchCID = async (cid: string) => {
    await queryClient.prefetchQuery({
      queryKey: ['ipfs', cid],
      queryFn: async () => {
        const content = await ipfsService.fetchQIP(cid);
        const { frontmatter, content: body } = ipfsService.parseQIPMarkdown(content);
        return { raw: content, frontmatter, body, cid };
      },
      staleTime: CACHE_TIMES.STALE_TIME.IPFS_CONTENT,
      gcTime: CACHE_TIMES.GC_TIME.IPFS_CONTENT,
    });
  };
  
  const prefetchMultiple = async (cids: string[]) => {
    // Prefetch in parallel but limit concurrency
    const BATCH_SIZE = 3;
    for (let i = 0; i < cids.length; i += BATCH_SIZE) {
      const batch = cids.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(prefetchCID));
    }
  };
  
  return { prefetchCID, prefetchMultiple };
}