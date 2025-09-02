import React from 'react';
import { useQuery, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { MaiAPIClient, MaiAPIQIP, FetchQIPsOptions } from '../services/maiApiClient';
import { QIPStatus } from '../services/qipClient';
import { QIPData } from './useQIPData';

interface UseQIPsFromAPIOptions {
  apiUrl?: string;
  includeContent?: boolean;
  contentFor?: number[];
  forceRefresh?: boolean;
  enabled?: boolean;
  pollingInterval?: number;
  queryOptions?: Omit<UseQueryOptions<QIPData[]>, 'queryKey' | 'queryFn'>;
}

/**
 * Hook to fetch QIPs from the Mai API endpoint
 * Provides 24x faster performance compared to direct blockchain fetching
 */
export function useQIPsFromAPI({
  apiUrl,
  includeContent = false,
  contentFor,
  forceRefresh = false,
  enabled = true,
  pollingInterval = 30000, // 30 seconds default
  queryOptions = {},
}: UseQIPsFromAPIOptions = {}) {
  const queryClient = useQueryClient();

  // Initialize API client
  const apiClient = React.useMemo(() => 
    new MaiAPIClient(apiUrl),
    [apiUrl]
  );

  // Main query for fetching QIPs
  const qipsQuery = useQuery<QIPData[]>({
    queryKey: ['qips', 'api', apiUrl, { includeContent, contentFor, forceRefresh }],
    queryFn: async () => {
      console.log('[useQIPsFromAPI] Fetching QIPs from API:', apiUrl);
      
      const options: FetchQIPsOptions = {
        includeContent,
        contentFor,
        forceRefresh,
      };

      try {
        const response = await apiClient.fetchQIPs(options);
        
        console.log(`[useQIPsFromAPI] ✅ Received ${response.qips.length} QIPs (cached: ${response.cached})`);
        
        // Convert API QIPs to app's QIPData format
        const qipData = response.qips.map(apiQip => MaiAPIClient.toQIPData(apiQip));
        
        // Sort by QIP number descending (newest first)
        qipData.sort((a, b) => b.qipNumber - a.qipNumber);
        
        return qipData;
      } catch (error: any) {
        console.error('[useQIPsFromAPI] ❌ API fetch failed:', error.message);
        console.log('[useQIPsFromAPI] 🔄 Note: The app should fall back to blockchain mode');
        throw error;
      }
    },
    enabled,
    refetchInterval: pollingInterval,
    staleTime: 10000, // 10 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    ...queryOptions,
  });

  // Get a specific QIP with content
  const getQIP = React.useCallback(
    (qipNumber: number) => {
      return useQuery({
        queryKey: ['qip', 'api', qipNumber, apiUrl],
        queryFn: async (): Promise<QIPData | null> => {
          console.log(`[useQIPsFromAPI] Fetching QIP ${qipNumber} with content`);
          
          const apiQip = await apiClient.fetchQIP(qipNumber);
          
          if (!apiQip) {
            return null;
          }
          
          return MaiAPIClient.toQIPData(apiQip);
        },
        enabled: enabled && qipNumber > 0,
        staleTime: 30000, // 30 seconds
        gcTime: 10 * 60 * 1000, // 10 minutes
      });
    },
    [apiClient, apiUrl, enabled]
  );

  // Filter QIPs by status
  const getQIPsByStatus = React.useCallback(
    (status: QIPStatus) => {
      const allQIPs = qipsQuery.data || [];
      return allQIPs.filter(qip => qip.statusEnum === status);
    },
    [qipsQuery.data]
  );

  // Get QIP counts by status
  const getQIPCounts = React.useCallback(() => {
    const allQIPs = qipsQuery.data || [];
    const counts = allQIPs.reduce((acc, qip) => {
      acc[qip.status] = (acc[qip.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      counts,
      total: allQIPs.length,
    };
  }, [qipsQuery.data]);

  // Invalidate queries for real-time updates
  const invalidateQIPs = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['qips', 'api'] });
  }, [queryClient]);

  // Prefetch QIP data
  const prefetchQIP = React.useCallback(
    (qipNumber: number) => {
      queryClient.prefetchQuery({
        queryKey: ['qip', 'api', qipNumber, apiUrl],
        queryFn: async () => {
          const apiQip = await apiClient.fetchQIP(qipNumber);
          return apiQip ? MaiAPIClient.toQIPData(apiQip) : null;
        },
        staleTime: 30000,
      });
    },
    [apiClient, apiUrl, queryClient]
  );

  // Force refresh data from API (bypass cache)
  const refreshQIPs = React.useCallback(async () => {
    console.log('[useQIPsFromAPI] Force refreshing QIPs');
    
    const response = await apiClient.fetchQIPs({ forceRefresh: true });
    const qipData = response.qips.map(apiQip => MaiAPIClient.toQIPData(apiQip));
    qipData.sort((a, b) => b.qipNumber - a.qipNumber);
    
    // Update the cache with fresh data
    queryClient.setQueryData(
      ['qips', 'api', apiUrl, { includeContent: false, contentFor: undefined, forceRefresh: false }],
      qipData
    );
    
    return qipData;
  }, [apiClient, apiUrl, queryClient]);

  return {
    // Data
    qips: qipsQuery.data || [],
    isLoading: qipsQuery.isLoading,
    isError: qipsQuery.isError,
    error: qipsQuery.error,
    
    // Methods
    getQIP,
    getQIPsByStatus,
    getQIPCounts,
    invalidateQIPs,
    prefetchQIP,
    refreshQIPs,
    
    // Status
    isFetching: qipsQuery.isFetching,
    isStale: qipsQuery.isStale,
    dataUpdatedAt: qipsQuery.dataUpdatedAt,
  };
}

/**
 * Hook for getting QIPs by status using the API
 */
export function useAPIQIPsByStatus(
  status: QIPStatus,
  options: UseQIPsFromAPIOptions = {}
) {
  const { qips, isLoading, isError, error } = useQIPsFromAPI(options);
  
  const filteredQIPs = React.useMemo(() => 
    qips.filter(qip => qip.statusEnum === status),
    [qips, status]
  );

  return {
    qips: filteredQIPs,
    isLoading,
    isError,
    error,
    count: filteredQIPs.length,
  };
}

/**
 * Hook for real-time QIP count by status using the API
 */
export function useAPIQIPCounts(options: UseQIPsFromAPIOptions = {}) {
  const { qips, isLoading } = useQIPsFromAPI(options);
  
  const counts = React.useMemo(() => {
    const statusCounts = qips.reduce((acc, qip) => {
      acc[qip.status] = (acc[qip.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      counts: statusCounts,
      total: qips.length,
    };
  }, [qips]);

  return {
    ...counts,
    isLoading,
  };
}