import type { Abi } from 'viem';
import type { ABIFetchResult, ContractMetadata } from '../types/abi';
import { getBlockExplorer } from '../config/blockExplorers';

/**
 * Etherscan API V2 response types
 */
interface EtherscanResponse {
  status: string;
  message: string;
  result: string | any[];
}

/**
 * Fetch contract ABI from Etherscan-compatible block explorer API V2
 *
 * Uses Etherscan API V2 endpoints (https://docs.etherscan.io/v2-migration)
 * The block explorer configuration automatically ensures V2 endpoints are used
 *
 * @param address - Contract address (with 0x prefix)
 * @param chainName - Chain name (e.g., "Ethereum", "Polygon")
 * @param signal - Optional AbortSignal to cancel the request
 * @returns Result with ABI and metadata or error
 */
export async function fetchContractABI(
  address: string,
  chainName: string,
  signal?: AbortSignal
): Promise<ABIFetchResult> {
  // Validate address format
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return {
      success: false,
      error: 'Invalid contract address format. Must be a valid Ethereum address (0x...)',
    };
  }

  // Get block explorer configuration
  const explorerConfig = getBlockExplorer(chainName);
  if (!explorerConfig || !explorerConfig.apiUrl) {
    return {
      success: false,
      error: `Block explorer not configured for chain: ${chainName}. Please paste ABI manually.`,
    };
  }

  try {
    // Build API URL
    const url = new URL(explorerConfig.apiUrl);
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getabi');
    url.searchParams.set('address', address);

    // Add chainid for Etherscan V2 unified API only
    // Don't add for Routescan (chainid in path) or Polygonscan V1 APIs
    const isEtherscanV2Unified = explorerConfig.apiUrl?.includes('api.etherscan.io/v2/api');
    if (isEtherscanV2Unified && explorerConfig.chainId) {
      url.searchParams.set('chainid', explorerConfig.chainId.toString());
    }

    // Add API key if available
    if (explorerConfig.apiKey) {
      url.searchParams.set('apikey', explorerConfig.apiKey);
    }

    console.log(`[ABI Service] Fetching ABI for ${address} on ${chainName}`);
    console.log(`[ABI Service] Explorer: ${explorerConfig.name} (chainId: ${explorerConfig.chainId})`);
    console.log(`[ABI Service] API URL: ${url.toString()}`);
    console.log(`[ABI Service] Has API Key: ${!!explorerConfig.apiKey}`);

    // Fetch from explorer API with abort signal
    const response = await fetch(url.toString(), { signal });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP error ${response.status}: ${response.statusText}`,
      };
    }

    const data: EtherscanResponse = await response.json();

    // Check API response status
    if (data.status !== '1') {
      // Handle common error messages
      if (data.result === 'Contract source code not verified') {
        return {
          success: false,
          error: 'Contract source code is not verified on this explorer. Please paste ABI manually.',
        };
      }
      if (data.result === 'Invalid Address format') {
        return {
          success: false,
          error: 'Invalid address format.',
        };
      }
      if (data.message === 'NOTOK') {
        return {
          success: false,
          error: (typeof data.result === 'string' ? data.result : undefined) || 'Failed to fetch ABI from explorer.',
        };
      }
      return {
        success: false,
        error: `Explorer API error: ${data.message || (typeof data.result === 'string' ? data.result : 'Unknown error')}`,
      };
    }

    // Parse ABI
    let abi: Abi;
    try {
      abi = JSON.parse(data.result as string);
    } catch (parseError) {
      return {
        success: false,
        error: 'Failed to parse ABI from explorer response.',
      };
    }

    // Validate ABI structure
    if (!Array.isArray(abi) || abi.length === 0) {
      return {
        success: false,
        error: 'Invalid ABI structure received from explorer.',
      };
    }

    // Try to get contract name from ABI (some ABIs include it)
    const contractName = extractContractName(abi) || 'Unknown Contract';

    const metadata: ContractMetadata = {
      name: contractName,
      abi,
      verified: true,
    };

    console.log(`[ABI Service] ✓ Successfully fetched ABI for ${contractName}`);

    return {
      success: true,
      data: metadata,
    };
  } catch (error) {
    console.error('[ABI Service] Error fetching ABI:', error);

    // Handle abort errors
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        success: false,
        error: 'Request was cancelled or timed out after 15 seconds.',
      };
    }

    // Handle network errors (including CORS)
    if (error instanceof TypeError && error.message.includes('fetch')) {
      // CORS or network error
      return {
        success: false,
        error: `Network error: Unable to reach ${explorerConfig.name} API. This could be due to:\n` +
               `1. CORS restrictions (browser blocking the request)\n` +
               `2. Network connectivity issues\n` +
               `3. Block explorer API is down\n` +
               `Please try pasting the ABI manually or check your network connection.`,
      };
    }

    return {
      success: false,
      error: `Failed to fetch ABI: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Attempt to extract contract name from ABI
 * Some ABIs include constructor or error messages with the contract name
 */
function extractContractName(abi: Abi): string | null {
  // Look for constructor
  for (const item of abi) {
    if (item.type === 'constructor') {
      // Some ABIs have a name field in constructor
      if ('name' in item && item.name) {
        return item.name as string;
      }
    }
  }

  // Could not extract name
  return null;
}

/**
 * Fetch contract source code (for additional metadata like contract name)
 * This is a separate API V2 call that provides more info
 *
 * @param address - Contract address
 * @param chainName - Chain name
 * @param signal - Optional AbortSignal to cancel the request
 * @returns Contract name, implementation address, and proxy type
 */
export async function fetchContractSource(
  address: string,
  chainName: string,
  signal?: AbortSignal
): Promise<{ name?: string; implementation?: string; proxy?: string }> {
  const explorerConfig = getBlockExplorer(chainName);
  if (!explorerConfig || !explorerConfig.apiUrl) {
    return {};
  }

  try {
    const url = new URL(explorerConfig.apiUrl);
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getsourcecode');
    url.searchParams.set('address', address);

    // Add chainid for Etherscan V2 unified API only
    // Don't add for Routescan (chainid in path) or Polygonscan V1 APIs
    const isEtherscanV2Unified = explorerConfig.apiUrl?.includes('api.etherscan.io/v2/api');
    if (isEtherscanV2Unified && explorerConfig.chainId) {
      url.searchParams.set('chainid', explorerConfig.chainId.toString());
    }

    if (explorerConfig.apiKey) {
      url.searchParams.set('apikey', explorerConfig.apiKey);
    }

    const response = await fetch(url.toString(), { signal });
    if (!response.ok) return {};

    const data: EtherscanResponse = await response.json();
    if (data.status !== '1') return {};

    const result = Array.isArray(data.result) ? data.result[0] : data.result;

    return {
      name: result.ContractName || undefined,
      implementation: result.Implementation || undefined,
      proxy: result.Proxy || undefined,
    };
  } catch (error) {
    console.warn('[ABI Service] Failed to fetch contract source:', error);
    return {};
  }
}

/**
 * Fetch contract ABI with enriched metadata (includes source code fetch)
 * Automatically detects and handles proxy contracts
 *
 * @param address - Contract address
 * @param chainName - Chain name
 * @param signal - Optional AbortSignal to cancel the request
 */
export async function fetchContractABIWithMetadata(
  address: string,
  chainName: string,
  signal?: AbortSignal
): Promise<ABIFetchResult> {
  // First, get source code data to check if it's a proxy
  const sourceData = await fetchContractSource(address, chainName, signal);

  // Check if this is a proxy contract
  const isProxy = !!(sourceData.implementation && sourceData.implementation !== '');
  const implementationAddress = sourceData.implementation;

  if (isProxy && implementationAddress) {
    console.log(`[ABI Service] Detected proxy contract at ${address}`);
    console.log(`[ABI Service] Fetching implementation ABI from ${implementationAddress}`);

    // Fetch the ABI from the implementation contract
    const implResult = await fetchContractABI(implementationAddress, chainName, signal);

    if (!implResult.success || !implResult.data) {
      // If implementation fetch fails, fall back to proxy ABI
      console.warn('[ABI Service] Failed to fetch implementation ABI, using proxy ABI');
      const proxyResult = await fetchContractABI(address, chainName, signal);

      if (!proxyResult.success || !proxyResult.data) {
        return proxyResult;
      }

      return {
        success: true,
        data: {
          ...proxyResult.data,
          name: sourceData.name || proxyResult.data.name,
          isProxy: true,
          implementation: implementationAddress,
          proxyType: sourceData.proxy,
        },
      };
    }

    // Get implementation contract name
    const implSourceData = await fetchContractSource(implementationAddress, chainName, signal);

    return {
      success: true,
      data: {
        ...implResult.data,
        name: implSourceData.name || sourceData.name || implResult.data.name,
        isProxy: true,
        implementation: implementationAddress,
        proxyType: sourceData.proxy,
      },
    };
  }

  // Not a proxy, fetch normally
  const abiResult = await fetchContractABI(address, chainName, signal);

  if (!abiResult.success || !abiResult.data) {
    return abiResult;
  }

  return {
    success: true,
    data: {
      ...abiResult.data,
      name: sourceData.name || abiResult.data.name,
      isProxy: false,
    },
  };
}
