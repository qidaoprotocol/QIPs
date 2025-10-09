import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { fetchContractABIWithMetadata } from '../services/abiService';
import type { ContractMetadata, ABIFetchResult } from '../types/abi';
import { queryKeys } from '../utils/queryKeys';
import { CACHE_TIMES } from '../config/queryClient';

interface UseContractABIOptions {
  enabled?: boolean;
  onSuccess?: (data: ContractMetadata) => void;
  onError?: (error: string) => void;
}

/**
 * Hook to fetch contract ABI from block explorer
 * Automatically caches results for 24 hours
 * Includes 15 second timeout per request
 *
 * @param address - Contract address
 * @param chain - Chain name (e.g., "Ethereum", "Polygon")
 * @param options - Query options
 */
export function useContractABI(
  address: string,
  chain: string,
  options: UseContractABIOptions = {}
): UseQueryResult<ContractMetadata, Error> {
  const { enabled = true, onSuccess, onError } = options;

  return useQuery<ContractMetadata, Error>({
    queryKey: queryKeys.contractABI(chain, address),
    queryFn: async ({ signal }) => {
      // Create a timeout abort controller (15 seconds)
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), 15000);

      // Combine React Query's signal with our timeout signal
      const combinedSignal = signal || timeoutController.signal;

      try {
        const result = await fetchContractABIWithMetadata(address, chain, combinedSignal);

        if (!result.success || !result.data) {
          const error = new Error(result.error || 'Failed to fetch ABI');
          onError?.(result.error || 'Failed to fetch ABI');
          throw error;
        }

        onSuccess?.(result.data);
        return result.data;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    enabled: enabled && !!address && !!chain,
    staleTime: CACHE_TIMES.STALE_TIME.CONTRACT_ABI,
    gcTime: CACHE_TIMES.GC_TIME.CONTRACT_ABI,
    retry: (failureCount, error) => {
      // Don't retry on verification errors, invalid address, or aborts
      if (
        error.message.includes('not verified') ||
        error.message.includes('Invalid address') ||
        error.message.includes('cancelled') ||
        error.message.includes('timed out')
      ) {
        return false;
      }
      // Retry up to 2 times for other errors
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
}

/**
 * Hook for manually fetching contract ABI (mutation version)
 * Useful for "Fetch ABI" button clicks
 * Includes 15 second timeout
 */
export function useFetchContractABI() {
  const queryClient = useQueryClient();

  return useMutation<
    ABIFetchResult,
    Error,
    { address: string; chain: string }
  >({
    mutationFn: async ({ address, chain }) => {
      // Create a timeout abort controller (15 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        return await fetchContractABIWithMetadata(address, chain, controller.signal);
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: (result, variables) => {
      // Cache the successful result
      if (result.success && result.data) {
        queryClient.setQueryData(
          queryKeys.contractABI(variables.chain, variables.address),
          result.data
        );
      }
    },
  });
}

/**
 * Hook to prefetch contract ABI without triggering a query
 * Useful for preloading common contracts
 * Includes 15 second timeout
 */
export function usePrefetchContractABI() {
  const queryClient = useQueryClient();

  return async (address: string, chain: string) => {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.contractABI(chain, address),
      queryFn: async () => {
        // Create a timeout abort controller (15 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
          const result = await fetchContractABIWithMetadata(address, chain, controller.signal);
          if (!result.success || !result.data) {
            throw new Error(result.error || 'Failed to fetch ABI');
          }
          return result.data;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      staleTime: CACHE_TIMES.STALE_TIME.CONTRACT_ABI,
    });
  };
}
