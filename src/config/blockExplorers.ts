import {
  mainnet,
  polygon,
  base,
  arbitrum,
  optimism,
  bsc,
  avalanche,
  gnosis,
  polygonZkEvm,
  linea,
  metis,
} from 'viem/chains';
import type { Chain } from 'viem';
import type { BlockExplorerConfig } from '../types/abi';
import { getEtherscanApiKey } from '../utils/settings';

/**
 * Map string chain names to Viem chain objects
 */
const CHAIN_MAP: Record<string, Chain> = {
  'Ethereum': mainnet,
  'Polygon': polygon,
  'Polygon PoS': polygon,
  'Base': base,
  'Arbitrum': arbitrum,
  'Optimism': optimism,
  'BSC': bsc,
  'BNB': bsc,
  'Binance': bsc,
  'Avalanche': avalanche,
  'Gnosis': gnosis,
  'Polygon zkEVM': polygonZkEvm,
  'Linea': linea,
  'Metis': metis,
};

/**
 * Chains that don't use Etherscan API keys
 * These require special handling
 */
const SPECIAL_API_KEY_CHAINS = new Set(['Metis']);

/**
 * Chain ID mapping for Etherscan V2 unified API
 * V2 uses a single endpoint with chainid parameter
 */
const CHAIN_IDS: Record<string, number> = {
  'Ethereum': 1,
  'Polygon': 137,
  'Polygon PoS': 137,
  'Base': 8453,
  'Arbitrum': 42161,
  'Optimism': 10,
  'BSC': 56,
  'BNB': 56,
  'Binance': 56,
  'Avalanche': 43114,
  'Gnosis': 100,
  'Polygon zkEVM': 1101,
  'Linea': 59144,
  'Metis': 1088,
};

/**
 * Hardcoded fallback explorer URLs for chains
 *
 * Most chains use Etherscan V2 unified endpoint (https://api.etherscan.io/v2/api)
 * and are differentiated by the chainid parameter.
 *
 * Exceptions that use their own API endpoints:
 * - Metis (1088): Uses Routescan API
 * - Polygon zkEVM (1101): Uses Polygonscan V1 API (not yet supported by Etherscan V2)
 *
 * See: https://docs.etherscan.io/v2-migration
 */
const FALLBACK_EXPLORERS: Record<string, Partial<BlockExplorerConfig>> = {
  'Ethereum': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://etherscan.io',
    name: 'Etherscan',
  },
  'Polygon': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://polygonscan.com',
    name: 'Polygonscan',
  },
  'Polygon PoS': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://polygonscan.com',
    name: 'Polygonscan',
  },
  'Base': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://basescan.org',
    name: 'Basescan',
  },
  'Arbitrum': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://arbiscan.io',
    name: 'Arbiscan',
  },
  'Optimism': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://optimistic.etherscan.io',
    name: 'Optimistic Etherscan',
  },
  'BSC': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://bscscan.com',
    name: 'BscScan',
  },
  'BNB': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://bscscan.com',
    name: 'BscScan',
  },
  'Binance': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://bscscan.com',
    name: 'BscScan',
  },
  'Avalanche': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://snowtrace.io',
    name: 'Snowtrace',
  },
  'Gnosis': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://gnosisscan.io',
    name: 'Gnosisscan',
  },
  'Metis': {
    apiUrl: 'https://api.routescan.io/v2/network/mainnet/evm/1088/etherscan/api',
    url: 'https://andromeda-explorer.metis.io',
    name: 'Metis Explorer',
  },
  'Polygon zkEVM': {
    apiUrl: 'https://api-zkevm.polygonscan.com/api',
    url: 'https://zkevm.polygonscan.com',
    name: 'Polygon zkEVM Scan',
  },
  'Linea': {
    apiUrl: 'https://api.etherscan.io/v2/api',
    url: 'https://lineascan.build',
    name: 'Lineascan',
  },
};

/**
 * Get API key for a specific chain
 * Uses ONLY user-provided API key from localStorage (Settings UI)
 * No environment variable fallback
 *
 * Special handling for chains that don't use Etherscan API:
 * - Metis: Uses "DUMMY" as API key (Routescan doesn't require authentication)
 */
function getApiKeyForChain(chainName: string): string | undefined {
  // Special handling for chains that don't use Etherscan API
  if (SPECIAL_API_KEY_CHAINS.has(chainName)) {
    if (chainName === 'Metis') {
      return 'DUMMY'; // Routescan doesn't require a real API key
    }
  }

  // Use unified Etherscan API key from user settings only
  return getEtherscanApiKey();
}

/**
 * Get custom explorer URL override from environment variables
 */
function getCustomExplorerUrl(chainName: string): string | undefined {
  const normalizedName = chainName.toUpperCase().replace(/\s+/g, '_');
  const envVarName = `VITE_EXPLORER_URL_${normalizedName}`;
  return import.meta.env[envVarName];
}

/**
 * Resolve a chain name to a Viem Chain object
 */
export function resolveChain(chainName: string): Chain | undefined {
  return CHAIN_MAP[chainName];
}

/**
 * Get chain ID for a given chain name
 */
export function getChainId(chainName: string): number | undefined {
  // Try to get from our mapping first
  const mappedId = CHAIN_IDS[chainName];
  if (mappedId) return mappedId;

  // Try to get from Viem chain definition
  const chain = resolveChain(chainName);
  return chain?.id;
}

/**
 * Get block explorer configuration for a specific chain
 *
 * For most chains (Etherscan V2 API):
 * - Uses UNIFIED endpoint: https://api.etherscan.io/v2/api
 * - 50+ supported chains use the same endpoint
 * - Chains are differentiated by the required chainid parameter
 * - Supports Ethereum, Polygon, Base, Arbitrum, Optimism, BSC, and more
 * - API key MUST be configured via Settings UI (no environment variables)
 *
 * Exceptions:
 * - Metis: Uses Routescan API with hardcoded "DUMMY" key (no user config needed)
 * - Polygon zkEVM: Uses Polygonscan V1 API (not yet supported by Etherscan V2)
 *
 * Priority order:
 * 1. Environment variable override (VITE_EXPLORER_URL_{CHAIN})
 * 2. Hardcoded fallback (V2 unified or chain-specific endpoint)
 * 3. Viem chain definitions are NOT used (they contain V1 endpoints)
 *
 * @param chainName - Name of the chain (e.g., "Ethereum", "Polygon")
 * @returns Block explorer configuration or undefined if not supported
 */
export function getBlockExplorer(chainName: string): BlockExplorerConfig | undefined {
  // Get chain ID (required for V2 API)
  const chainId = getChainId(chainName);
  if (!chainId) {
    console.warn(`[Block Explorer] No chain ID found for ${chainName}`);
  }

  // Check for custom URL override
  const customUrl = getCustomExplorerUrl(chainName);

  // Get API key from environment
  const apiKey = getApiKeyForChain(chainName);

  // Try to get from Viem chain definition
  const chain = resolveChain(chainName);
  const viemExplorer = chain?.blockExplorers?.default;

  // Get fallback explorer
  const fallback = FALLBACK_EXPLORERS[chainName];

  // Get API URL with priority
  // IMPORTANT: Never use viemExplorer?.apiUrl as it contains V1 endpoints
  // We only use our V2-compatible fallback URLs or custom overrides
  const apiUrl = customUrl || fallback?.apiUrl;

  // Warn if we don't have a V2 endpoint configured
  if (!apiUrl && viemExplorer?.apiUrl) {
    console.warn(
      `[Block Explorer] No V2 endpoint configured for chain "${chainName}". ` +
      `Viem provides V1 endpoint (${viemExplorer.apiUrl}) but it's not compatible. ` +
      `Please add a V2 endpoint to FALLBACK_EXPLORERS or set VITE_EXPLORER_URL_${chainName.toUpperCase().replace(/\s+/g, '_')}`
    );
  }

  // Build final configuration
  const config: BlockExplorerConfig = {
    apiUrl,
    // Display URL: viem > fallback
    url: viemExplorer?.url || fallback?.url,
    // Name: viem > fallback > default
    name: viemExplorer?.name || fallback?.name || `${chainName} Explorer`,
    // API key from environment
    apiKey,
    // Chain ID for V2 API
    chainId,
  };

  // Return undefined if we don't have at least an API URL
  if (!config.apiUrl) {
    return undefined;
  }

  return config;
}

/**
 * Get list of all supported chains (chains with explorer configs)
 */
export function getSupportedChains(): string[] {
  return Object.keys(CHAIN_MAP);
}

/**
 * Check if a chain has explorer support
 */
export function isChainSupported(chainName: string): boolean {
  return getBlockExplorer(chainName) !== undefined;
}

/**
 * Get block explorer URL for a contract address
 * @param chainName - Name of the chain (e.g., "Ethereum", "Polygon")
 * @param address - Contract address (0x...)
 * @returns Full URL to view the address on the block explorer, or undefined if chain not supported
 */
export function getAddressExplorerUrl(chainName: string, address: string): string | undefined {
  const explorer = getBlockExplorer(chainName);
  if (!explorer?.url) {
    return undefined;
  }

  return `${explorer.url}/address/${address}`;
}
