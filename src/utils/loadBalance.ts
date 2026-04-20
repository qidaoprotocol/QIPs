import { type Transport, type TransportConfig, createTransport } from "viem";

const COOLDOWN_MS = 30_000;

/**
 * @description Creates a load balanced transport that spreads requests between
 * child transports using round robin, and fails over to the next available
 * transport when one rejects. Failed slots are placed in a short cooldown so
 * subsequent requests skip them until they're likely healthy again.
 */
export const loadBalance = (_transports: Transport[]): Transport => {
  return ({ chain, retryCount, timeout }) => {
    const transports = _transports.map((t) =>
      chain === undefined
        ? t({ retryCount: 0, timeout })
        : t({ chain, retryCount: 0, timeout }),
    );

    let index = 0;
    const cooldownUntil = new Map<number, number>();

    const isAvailable = (slot: number): boolean => {
      const until = cooldownUntil.get(slot);
      if (until === undefined) return true;
      if (Date.now() >= until) {
        cooldownUntil.delete(slot);
        return true;
      }
      return false;
    };

    return createTransport({
      key: "loadBalance",
      name: "Load Balance",
      request: async (body) => {
        const start = index;
        index = (index + 1) % transports.length;

        let lastError: unknown;
        let triedAny = false;

        // First pass: only hit slots that aren't cooling down.
        for (let i = 0; i < transports.length; i++) {
          const slot = (start + i) % transports.length;
          if (!isAvailable(slot)) continue;
          triedAny = true;
          try {
            return await transports[slot]!.request(body);
          } catch (err) {
            lastError = err;
            cooldownUntil.set(slot, Date.now() + COOLDOWN_MS);
          }
        }

        // If every slot was in cooldown, try them anyway so we don't strand
        // callers when all endpoints are simultaneously degraded.
        if (!triedAny) {
          for (let i = 0; i < transports.length; i++) {
            const slot = (start + i) % transports.length;
            try {
              return await transports[slot]!.request(body);
            } catch (err) {
              lastError = err;
              cooldownUntil.set(slot, Date.now() + COOLDOWN_MS);
            }
          }
        }

        throw lastError;
      },
      retryCount,
      timeout,
      type: "loadBalance",
    } as TransportConfig);
  };
};

/**
 * Base mainnet RPC endpoints
 * Using multiple providers to avoid rate limits
 */
export const BASE_RPC_ENDPOINTS = [
  "https://mainnet.base.org",
  "https://base-mainnet.public.blastapi.io",
  "https://base.blockpi.network/v1/rpc/public",
  "https://base.meowrpc.com",
  "https://base.publicnode.com",
  "https://1rpc.io/base",
];

/**
 * Ethereum mainnet RPC endpoints.
 * Used for cross-chain reads like the QI token balance check on L1.
 */
export const ETH_RPC_ENDPOINTS = [
  "https://eth.llamarpc.com",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.ankr.com/eth",
  "https://1rpc.io/eth",
  "https://eth.meowrpc.com",
];

/**
 * Get Ethereum mainnet RPC endpoints. Honors `VITE_MAINNET_RPC_URL`
 * (single) or `VITE_MAINNET_RPC_URLS` (comma-separated) if set, otherwise
 * falls back to the public list above.
 */
export function getEthRPCEndpoints(): string[] {
  if (typeof import.meta !== "undefined") {
    const urls = import.meta.env?.VITE_MAINNET_RPC_URLS;
    if (typeof urls === "string" && urls.length > 0) {
      return urls.split(",").map((u) => u.trim()).filter(Boolean);
    }
    const single = import.meta.env?.VITE_MAINNET_RPC_URL;
    if (typeof single === "string" && single.length > 0 && !ETH_RPC_ENDPOINTS.includes(single)) {
      return [single, ...ETH_RPC_ENDPOINTS];
    }
  }
  return ETH_RPC_ENDPOINTS;
}

/**
 * Get RPC endpoints from environment or use defaults
 */
export function getRPCEndpoints(): string[] {
  // Check local mode FIRST - this takes priority over everything
  const isLocalMode = typeof import.meta !== 'undefined' 
    ? import.meta.env?.VITE_LOCAL_MODE === 'true' || import.meta.env?.VITE_LOCAL_MODE === true
    : false;
    
  // Check for single RPC URL
  const singleUrl = typeof import.meta !== 'undefined' 
    ? import.meta.env?.VITE_BASE_RPC_URL 
    : undefined;
    
  // In local mode or when URL is localhost, ONLY use that single URL
  if (singleUrl && (isLocalMode || singleUrl.includes('localhost') || singleUrl.includes('127.0.0.1'))) {
    console.log('[getRPCEndpoints] Local mode detected, using only:', singleUrl);
    return [singleUrl];
  }
  
  // Check if user has configured custom endpoints (only if not in local mode)
  if (!isLocalMode && typeof import.meta !== 'undefined' && import.meta.env?.VITE_BASE_RPC_URLS) {
    const urls = import.meta.env.VITE_BASE_RPC_URLS;
    if (typeof urls === 'string') {
      return urls.split(',').map(url => url.trim()).filter(Boolean);
    }
  }
    
  // If we have a single URL (non-local), add it to the list for redundancy
  if (singleUrl && !BASE_RPC_ENDPOINTS.includes(singleUrl)) {
    return [singleUrl, ...BASE_RPC_ENDPOINTS];
  }
  
  return BASE_RPC_ENDPOINTS;
}