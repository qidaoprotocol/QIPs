/**
 * Centralized query key factory for React Query
 * Ensures consistent cache key generation across all hooks
 */

/**
 * Normalize QIP number to ensure consistent type
 * Always returns a number type for cache key consistency
 */
const normalizeQIPNumber = (qipNumber: string | number): number => {
  return typeof qipNumber === 'string' ? parseInt(qipNumber, 10) : qipNumber;
};

/**
 * Query key factory for all QIP-related queries
 */
export const queryKeys = {
  // Individual QIP queries
  qip: (qipNumber: string | number, registryAddress: string | undefined) => 
    ['qip', normalizeQIPNumber(qipNumber), registryAddress] as const,
  
  // Blockchain data queries
  qipBlockchain: (qipNumber: string | number, registryAddress: string | undefined) => 
    ['qip-blockchain', normalizeQIPNumber(qipNumber), registryAddress] as const,
  
  // IPFS content queries
  ipfs: (ipfsUrl: string) => 
    ['ipfs', ipfsUrl] as const,
  
  // List and pagination queries
  qipsList: (registryAddress: string | undefined) => 
    ['qips', 'blockchain', registryAddress] as const,
  
  qipsPage: (registryAddress: string | undefined, page: number, pageSize: number) => 
    ['qips-page', registryAddress, page, pageSize] as const,
  
  qipsPaginationState: (registryAddress: string | undefined) => 
    ['qips-pagination-state', registryAddress] as const,
  
  qipNumbers: (registryAddress: string | undefined) => 
    ['qip-numbers', registryAddress] as const,
  
  // Status-based queries
  qipsByStatus: (registryAddress: string | undefined, status?: number) => 
    status !== undefined 
      ? ['qips', 'status', registryAddress, status] as const
      : ['qips', 'status', registryAddress] as const,
  
  // Author-based queries
  qipsByAuthor: (registryAddress: string | undefined, author: string) => 
    ['qips', 'author', registryAddress, author] as const,
  
  // Version history queries
  qipVersions: (qipNumber: string | number, registryAddress: string | undefined) => 
    ['qip', 'versions', normalizeQIPNumber(qipNumber), registryAddress] as const,
  
  // Filtered list queries
  qipsFiltered: (registryAddress: string | undefined, filters: { status?: string; author?: string; network?: string }) => 
    ['qips', 'list', registryAddress, filters] as const,
  
  // Snapshot proposal queries
  proposals: (snapshotSpace: string) => 
    ['proposals', snapshotSpace] as const,
  
  // Token balance queries
  tokenBalance: (tokenAddress: string, connectionState: string, requiresTokenBalance: boolean) => 
    ['tokenBalance', tokenAddress, connectionState, requiresTokenBalance] as const,
} as const;

/**
 * Query key patterns for invalidation
 * Use these with queryClient.invalidateQueries({ queryKey: pattern })
 */
export const queryKeyPatterns = {
  // Invalidate all QIP-related queries
  allQips: ['qips'] as const,
  
  // Invalidate specific QIP and its related data
  singleQip: (qipNumber: string | number) => 
    ['qip', normalizeQIPNumber(qipNumber)] as const,
  
  // Invalidate all IPFS content
  allIpfs: ['ipfs'] as const,
  
  // Invalidate all pagination states
  allPagination: ['qips-pagination-state'] as const,
  
  // Invalidate all pages
  allPages: ['qips-page'] as const,
} as const;