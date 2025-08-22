import { type Transport, type TransportConfig, createTransport } from "viem";

/**
 * @description Creates a load balanced transport that spreads requests between child transports using a round robin algorithm.
 */
export const loadBalance = (_transports: Transport[]): Transport => {
  return ({ chain, retryCount, timeout }) => {
    const transports = _transports.map((t) =>
      chain === undefined
        ? t({ retryCount: 0, timeout })
        : t({ chain, retryCount: 0, timeout }),
    );

    let index = 0;

    return createTransport({
      key: "loadBalance",
      name: "Load Balance",
      request: (body) => {
        const response = transports[index++]!.request(body);
        if (index === transports.length) index = 0;

        return response;
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
  'https://base.api.onfinality.io/public',
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://base-mainnet.public.blastapi.io',
  'https://base.blockpi.network/v1/rpc/public',
  'https://base.meowrpc.com',
  'https://base.publicnode.com',
  'https://1rpc.io/base',
];

/**
 * Get RPC endpoints from environment or use defaults
 */
export function getRPCEndpoints(): string[] {
  // Check if user has configured custom endpoints
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BASE_RPC_URLS) {
    const urls = import.meta.env.VITE_BASE_RPC_URLS;
    if (typeof urls === 'string') {
      return urls.split(',').map(url => url.trim()).filter(Boolean);
    }
  }
  
  // Check for single RPC URL and add it to the list
  const singleUrl = typeof import.meta !== 'undefined' 
    ? import.meta.env?.VITE_BASE_RPC_URL 
    : undefined;
    
  if (singleUrl && !BASE_RPC_ENDPOINTS.includes(singleUrl)) {
    return [singleUrl, ...BASE_RPC_ENDPOINTS];
  }
  
  return BASE_RPC_ENDPOINTS;
}