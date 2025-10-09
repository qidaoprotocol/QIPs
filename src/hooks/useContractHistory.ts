import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CachedContract } from '../types/abi';
import { queryKeys } from '../utils/queryKeys';
import { CACHE_TIMES } from '../config/queryClient';

// Maximum number of contracts to keep in history
const MAX_HISTORY_SIZE = 50;

/**
 * Hook to manage contract history
 * Stores previously used contracts for quick reuse
 */
export function useContractHistory() {
  const queryClient = useQueryClient();

  // Query to get contract history
  const query = useQuery<CachedContract[]>({
    queryKey: queryKeys.contractHistory(),
    queryFn: () => {
      // Initial empty array
      return [];
    },
    staleTime: CACHE_TIMES.STALE_TIME.CONTRACT_HISTORY,
    gcTime: CACHE_TIMES.GC_TIME.CONTRACT_HISTORY,
    initialData: [],
  });

  // Mutation to add contract to history
  const addMutation = useMutation({
    mutationFn: async (contract: CachedContract) => {
      const currentHistory = queryClient.getQueryData<CachedContract[]>(
        queryKeys.contractHistory()
      ) || [];

      // Check if contract already exists (by address + chain)
      const existingIndex = currentHistory.findIndex(
        (c) => c.address.toLowerCase() === contract.address.toLowerCase() && c.chain === contract.chain
      );

      let newHistory: CachedContract[];

      if (existingIndex >= 0) {
        // Update existing contract (move to front, update lastUsed)
        newHistory = [
          { ...contract, lastUsed: Date.now() },
          ...currentHistory.slice(0, existingIndex),
          ...currentHistory.slice(existingIndex + 1),
        ];
      } else {
        // Add new contract to front
        newHistory = [
          { ...contract, lastUsed: Date.now() },
          ...currentHistory,
        ];
      }

      // Limit history size
      if (newHistory.length > MAX_HISTORY_SIZE) {
        newHistory = newHistory.slice(0, MAX_HISTORY_SIZE);
      }

      return newHistory;
    },
    onSuccess: (newHistory) => {
      queryClient.setQueryData(queryKeys.contractHistory(), newHistory);
    },
  });

  // Mutation to remove contract from history
  const removeMutation = useMutation({
    mutationFn: async ({
      address,
      chain,
    }: {
      address: string;
      chain: string;
    }) => {
      const currentHistory = queryClient.getQueryData<CachedContract[]>(
        queryKeys.contractHistory()
      ) || [];

      const newHistory = currentHistory.filter(
        (c) => !(c.address.toLowerCase() === address.toLowerCase() && c.chain === chain)
      );

      return newHistory;
    },
    onSuccess: (newHistory) => {
      queryClient.setQueryData(queryKeys.contractHistory(), newHistory);
    },
  });

  // Mutation to clear all history
  const clearMutation = useMutation({
    mutationFn: async () => [],
    onSuccess: (newHistory) => {
      queryClient.setQueryData(queryKeys.contractHistory(), newHistory);
    },
  });

  return {
    // History data
    contracts: query.data || [],
    isLoading: query.isLoading,

    // Mutations
    addToHistory: addMutation.mutateAsync,
    removeFromHistory: removeMutation.mutateAsync,
    clearHistory: clearMutation.mutateAsync,

    // Mutation states
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
    isClearing: clearMutation.isPending,
  };
}

/**
 * Hook to get filtered contract history by chain
 */
export function useContractHistoryByChain(chain?: string) {
  const { contracts, ...rest } = useContractHistory();

  const filtered = chain
    ? contracts.filter((c) => c.chain === chain)
    : contracts;

  return {
    contracts: filtered,
    ...rest,
  };
}

/**
 * Hook to search contract history
 */
export function useContractHistorySearch(searchTerm?: string) {
  const { contracts, ...rest } = useContractHistory();

  const filtered = searchTerm
    ? contracts.filter(
        (c) =>
          c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.address.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : contracts;

  return {
    contracts: filtered,
    ...rest,
  };
}
