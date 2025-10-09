import type { Abi } from 'viem';

/**
 * Metadata for a cached contract
 */
export interface CachedContract {
  address: string;
  chain: string;
  name: string;
  abi: Abi;
  lastUsed: number; // Timestamp
  verified: boolean;
}

/**
 * Contract metadata returned from block explorer
 */
export interface ContractMetadata {
  name: string;
  abi: Abi;
  verified: boolean;
  isProxy?: boolean; // True if this is a proxy contract
  implementation?: string; // Implementation address for proxy contracts
  proxyType?: string; // Type of proxy (EIP-1967, etc.)
}

/**
 * Result from ABI fetch operation
 */
export interface ABIFetchResult {
  success: boolean;
  data?: ContractMetadata;
  error?: string;
}

/**
 * Block explorer configuration
 */
export interface BlockExplorerConfig {
  apiUrl?: string;
  url?: string;
  apiKey?: string;
  name: string;
  chainId?: number; // Chain ID for V2 API
}
