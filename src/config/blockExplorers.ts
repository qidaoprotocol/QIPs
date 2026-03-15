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
  fraxtal,
  kava,
} from 'viem/chains';
import type { Chain } from 'viem';
import type { BlockExplorerConfig } from '../types/abi';
import { getEtherscanApiKey } from '../utils/settings';
import { getChainByName, getAllChainNames } from './proposalChains';

/**
 * Map chain IDs to Viem chain objects.
 * Used by resolveChain() for viem/wagmi interop.
 */
const VIEM_CHAINS_BY_ID: Record<number, Chain> = {
  1: mainnet,
  137: polygon,
  8453: base,
  42161: arbitrum,
  10: optimism,
  56: bsc,
  43114: avalanche,
  100: gnosis,
  1101: polygonZkEvm,
  59144: linea,
  1088: metis,
  252: fraxtal,
  2222: kava,
};

/**
 * Get API key for a specific chain.
 * Special handling for chains that don't use Etherscan API:
 * - Metis (1088): Uses "DUMMY" as API key (Routescan doesn't require authentication)
 */
function getApiKeyForChain(chainName: string): string | undefined {
  const chain = getChainByName(chainName);
  if (chain?.chainId === 1088) {
    return 'DUMMY';
  }
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
  const chain = getChainByName(chainName);
  if (!chain) return undefined;
  return VIEM_CHAINS_BY_ID[chain.chainId];
}

/**
 * Get chain ID for a given chain name
 */
export function getChainId(chainName: string): number | undefined {
  return getChainByName(chainName)?.chainId;
}

/**
 * Get block explorer configuration for a specific chain.
 *
 * Most chains use Etherscan V2 unified endpoint differentiated by chainid parameter.
 *
 * Exceptions:
 * - Metis: Uses Routescan API with hardcoded "DUMMY" key
 * - Polygon zkEVM: Uses Polygonscan V1 API
 * - Fraxtal: Uses Fraxscan API
 * - Kava: No API available (returns undefined)
 *
 * Priority order:
 * 1. Environment variable override (VITE_EXPLORER_URL_{CHAIN})
 * 2. Registry explorerApiUrl
 *
 * IMPORTANT: Viem chain definitions contain V1 endpoints — never used for API calls.
 */
export function getBlockExplorer(chainName: string): BlockExplorerConfig | undefined {
  const chain = getChainByName(chainName);
  if (!chain) {
    console.warn(`[Block Explorer] Unknown chain: ${chainName}`);
    return undefined;
  }

  const customUrl = getCustomExplorerUrl(chainName);
  const apiKey = getApiKeyForChain(chainName);
  const viemChain = VIEM_CHAINS_BY_ID[chain.chainId];
  const viemExplorer = viemChain?.blockExplorers?.default;

  // API URL: custom override > registry
  const apiUrl = customUrl || chain.explorerApiUrl;

  // Return undefined if no API endpoint (e.g., Kava)
  if (!apiUrl) {
    return undefined;
  }

  return {
    apiUrl,
    url: chain.explorerUrl || viemExplorer?.url,
    name: viemExplorer?.name || `${chain.name} Explorer`,
    apiKey,
    chainId: chain.chainId,
  };
}

/**
 * Get list of all supported chain names
 */
export function getSupportedChains(): string[] {
  return getAllChainNames();
}

/**
 * Check if a chain has explorer API support (for ABI fetching)
 */
export function isChainSupported(chainName: string): boolean {
  return getBlockExplorer(chainName) !== undefined;
}

/**
 * Get block explorer URL for a contract address
 */
export function getAddressExplorerUrl(chainName: string, address: string): string | undefined {
  const chain = getChainByName(chainName);
  if (!chain) return undefined;
  return `${chain.explorerUrl}/address/${address}`;
}
