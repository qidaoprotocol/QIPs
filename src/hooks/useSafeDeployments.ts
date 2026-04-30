import { useQuery } from '@tanstack/react-query';
import { getMaiAPIClient } from '../services/maiApiClient';
import { config } from '../config/env';

/**
 * Detect which chains an address is deployed on as a Safe smart-account.
 *
 * Safe addresses are deterministic across chains via the Safe Singleton
 * Factory + CREATE2, so the same address may exist on multiple chains —
 * or none at all (in which case the address is most likely an EOA).
 *
 * From the wallet side (Rabby, MetaMask, WalletConnect, ConnectKit) there
 * is no EIP-1193 method that says "this account is a Safe" — even Rabby's
 * Safe-import feature still presents the address through the standard
 * personal_sign / eth_signTypedData interface. We probe instead.
 *
 * The probe is performed server-side by the mai-api `/v2/safe-deployments`
 * endpoint, which does on-chain `eth_getCode` + Safe ABI multicall against
 * mainnet, polygon, base, and linea — the four chains where qidao-relevant
 * Safes live — with results cached in Redis for 90 days. The frontend used
 * to fan out to Safe Transaction Service directly, but the unauthenticated
 * tier there is rate-limited (5,000 req/month / 2 RPS), so the central
 * endpoint owns the cache and the RPC budget instead.
 */

export interface SafeDeployments {
  /** chainIds where this address is a deployed Safe. */
  readonly deployedOn: readonly number[];
  /** chainIds where the lookup couldn't conclude (RPC issue, etc.). */
  readonly unknown: readonly number[];
}

async function fetchSafeDeployments(address: string): Promise<SafeDeployments> {
  const client = getMaiAPIClient(config.maiApiUrl);
  try {
    const res = await client.getSafeDeployments(address);
    return { deployedOn: res.deployedOn, unknown: res.unknown };
  } catch {
    // Endpoint unavailable / network error — treat as fully unknown.
    // pickSiweChainId then falls back to the wallet's reported chainId.
    return { deployedOn: [], unknown: [1, 137, 8453, 59144] };
  }
}

/**
 * Cached lookup for an address's Safe deployments. Empty `deployedOn` and
 * empty `unknown` together means we confirmed the address is not a Safe on
 * any of the four target chains (treat as EOA). Empty `deployedOn` with a
 * non-empty `unknown` means we couldn't fully probe — consumers should
 * fall back to the wallet's reported chainId rather than assume EOA.
 */
export function useSafeDeployments(
  address: string | undefined,
): {
  data: SafeDeployments | undefined;
  isLoading: boolean;
} {
  const cacheKey = address?.toLowerCase();
  const query = useQuery({
    queryKey: ['safe-deployments', cacheKey],
    queryFn: () => fetchSafeDeployments(address as string),
    enabled: typeof address === 'string' && address.length > 0,
    // Safe deployments are stable for the lifetime of an address. The
    // server-side cache TTL is 90 days; React Query keeps the result
    // for the whole session.
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000, // 1 hour
    retry: (failureCount, error) => {
      void error;
      // fetchSafeDeployments never throws (it catches and returns
      // a fully-unknown result), so retries here would be pointless.
      return failureCount < 1;
    },
  });
  return { data: query.data, isLoading: query.isLoading };
}

/**
 * Pick the SIWE message chainId given the wallet's reported chain and the
 * Safe-deployment lookup. Priority:
 *
 *   1. Safe deployed on exactly one chain → that chainId (load-bearing
 *      for EIP-1271: the verifier's RPC must be on the chain where the
 *      smart-account contract code lives).
 *   2. Safe deployed on multiple chains AND the wallet's current chain is
 *      one of them → prefer the wallet's chainId (matches the wallet's
 *      view of where it's signing).
 *   3. Safe deployed on multiple chains, wallet's chain not among them →
 *      first deployment chain (we have to pick one).
 *   4. Probe didn't conclude (some chains unknown, none confirmed) →
 *      wallet's chainId — fall back gracefully so a flaky Safe API
 *      doesn't block sign-in.
 *   5. Probe concluded but found no deployments → wallet's chainId
 *      (treat as EOA — chainId is informational for ECDSA recovery).
 */
export function pickSiweChainId(
  walletChainId: number,
  safeDeployments: SafeDeployments | undefined,
): number {
  if (!safeDeployments) return walletChainId;
  const { deployedOn } = safeDeployments;
  if (deployedOn.length === 0) return walletChainId;
  if (deployedOn.length === 1) return deployedOn[0]!;
  if (deployedOn.includes(walletChainId)) return walletChainId;
  return deployedOn[0]!;
}
