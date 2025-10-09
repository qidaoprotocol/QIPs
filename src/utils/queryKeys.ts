/**
 * Centralized query key factory for React Query
 * Ensures consistent cache key generation across all hooks
 */

/**
 * Normalize QCI number to ensure consistent type
 * Always returns a number type for cache key consistency
 */
const normalizeQCINumber = (qciNumber: string | number): number => {
  return typeof qciNumber === 'string' ? parseInt(qciNumber, 10) : qciNumber;
};

/**
 * Query key factory for all QCI-related queries
 */
export const queryKeys = {
  // Individual QCI queries
  qci: (qciNumber: string | number, registryAddress: string | undefined) => 
    ['qci', normalizeQCINumber(qciNumber), registryAddress] as const,
  
  // Blockchain data queries
  qciBlockchain: (qciNumber: string | number, registryAddress: string | undefined) => 
    ['qci-blockchain', normalizeQCINumber(qciNumber), registryAddress] as const,
  
  // IPFS content queries
  ipfs: (ipfsUrl: string) => 
    ['ipfs', ipfsUrl] as const,
  
  // List and pagination queries
  qcisList: (registryAddress: string | undefined) => 
    ['qcis', 'blockchain', registryAddress] as const,
  
  qcisPage: (registryAddress: string | undefined, page: number, pageSize: number) => 
    ['qcis-page', registryAddress, page, pageSize] as const,
  
  qcisPaginationState: (registryAddress: string | undefined) => 
    ['qcis-pagination-state', registryAddress] as const,
  
  qciNumbers: (registryAddress: string | undefined) => 
    ['qci-numbers', registryAddress] as const,
  
  // Status-based queries
  qcisByStatus: (registryAddress: string | undefined, status?: number) => 
    status !== undefined 
      ? ['qcis', 'status', registryAddress, status] as const
      : ['qcis', 'status', registryAddress] as const,
  
  // Author-based queries
  qcisByAuthor: (registryAddress: string | undefined, author: string) => 
    ['qcis', 'author', registryAddress, author] as const,
  
  // Version history queries
  qciVersions: (qciNumber: string | number, registryAddress: string | undefined) => 
    ['qci', 'versions', normalizeQCINumber(qciNumber), registryAddress] as const,
  
  // Filtered list queries
  qcisFiltered: (registryAddress: string | undefined, filters: { status?: string; author?: string; network?: string }) => 
    ['qcis', 'list', registryAddress, filters] as const,
  
  // Snapshot proposal queries
  proposals: (snapshotSpace: string) => 
    ['proposals', snapshotSpace] as const,
  
  // Token balance queries
  tokenBalance: (tokenAddress: string, connectionState: string, requiresTokenBalance: boolean) =>
    ['tokenBalance', tokenAddress, connectionState, requiresTokenBalance] as const,

  // Status queries
  allStatuses: (registryAddress: string | undefined) =>
    ['statuses', registryAddress] as const,

  // Contract ABI queries
  contractABI: (chain: string, address: string) =>
    ['contract-abi', chain, address] as const,

  // Contract history queries
  contractHistory: () =>
    ['contract-history'] as const,
} as const;

/**
 * Query key patterns for invalidation
 * Use these with queryClient.invalidateQueries({ queryKey: pattern })
 */
export const queryKeyPatterns = {
  // Invalidate all QCI-related queries
  allQips: ['qcis'] as const,
  
  // Invalidate specific QCI and its related data
  singleQip: (qciNumber: string | number) => 
    ['qci', normalizeQCINumber(qciNumber)] as const,
  
  // Invalidate all IPFS content
  allIpfs: ['ipfs'] as const,
  
  // Invalidate all pagination states
  allPagination: ['qcis-pagination-state'] as const,
  
  // Invalidate all pages
  allPages: ['qcis-page'] as const,

  // Invalidate all contract ABIs
  allContractABIs: ['contract-abi'] as const,

  // Invalidate contract history
  contractHistory: ['contract-history'] as const,
} as const;