import { useQuery } from '@tanstack/react-query';

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
 * personal_sign / eth_signTypedData interface. We probe instead: the Safe
 * Transaction Service exposes a per-chain endpoint that returns 200 when
 * the address is a deployed Safe on that chain, and 404 otherwise.
 *
 * The probe is rate-limited per IP, so network failures or 429s are
 * surfaced separately from confirmed-not-deployed (404). Consumers can
 * decide whether an unknown answer should fall back to "treat as EOA"
 * (current SIWE wallet chain) or wait for retry.
 */

export interface SafeDeployments {
  /** chainIds where this address is a deployed Safe (HTTP 200). */
  readonly deployedOn: readonly number[];
  /** chainIds we couldn't reach (network error, timeout, 429). */
  readonly unknown: readonly number[];
}

/**
 * Per-chain Safe Transaction Service hosts. Mirrors the Snapshot qidao.eth
 * matrix — keep in sync with src/config/chains.ts.
 *
 * If a chain in our allowlist is missing here, the deployment lookup will
 * silently treat that chain as "unknown" and the SIWE flow falls back to
 * the wallet's reported chainId.
 */
const SAFE_TX_SERVICE_HOSTS: Readonly<Record<number, string>> = {
  1: 'safe-transaction-mainnet.safe.global',
  10: 'safe-transaction-optimism.safe.global',
  100: 'safe-transaction-gnosis-chain.safe.global',
  137: 'safe-transaction-polygon.safe.global',
  8453: 'safe-transaction-base.safe.global',
  42161: 'safe-transaction-arbitrum.safe.global',
};

const PROBE_TIMEOUT_MS = 6000;
const PROBE_RETRY_DELAYS_MS = [1000, 3000] as const;

async function fetchOne(
  url: string,
): Promise<'deployed' | 'not_deployed' | 'rate_limited' | 'unknown'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.status === 200) return 'deployed';
    if (res.status === 404) return 'not_deployed';
    // 429 is common in burst — retryable.
    if (res.status === 429) return 'rate_limited';
    // 5xx is also worth a retry, but treat the same conservatively.
    if (res.status >= 500 && res.status < 600) return 'rate_limited';
    return 'unknown';
  } catch {
    // Network failure or timeout — also retryable.
    return 'rate_limited';
  } finally {
    clearTimeout(timer);
  }
}

async function probeOne(
  chainId: number,
  host: string,
  address: string,
): Promise<'deployed' | 'not_deployed' | 'unknown'> {
  void chainId;
  const url = `https://${host}/api/v1/safes/${address}/`;
  // First attempt + per-chain retries with backoff. The retry budget is
  // small on purpose: in production the hook fires once per session per
  // address, and any retry tax is absorbed by the wallet sign-in latency
  // that happens after.
  for (let attempt = 0; ; attempt++) {
    const outcome = await fetchOne(url);
    if (outcome !== 'rate_limited') {
      return outcome;
    }
    const delay = PROBE_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      // Exhausted retries — treat as unknown so the caller can fall back
      // to the wallet's reported chainId.
      return 'unknown';
    }
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function probeAllChains(address: string): Promise<SafeDeployments> {
  const entries = Object.entries(SAFE_TX_SERVICE_HOSTS) as readonly [
    string,
    string,
  ][];
  const results = await Promise.all(
    entries.map(async ([chainIdStr, host]) => {
      const chainId = Number(chainIdStr);
      const outcome = await probeOne(chainId, host, address);
      return { chainId, outcome };
    }),
  );
  const deployedOn: number[] = [];
  const unknown: number[] = [];
  for (const r of results) {
    if (r.outcome === 'deployed') deployedOn.push(r.chainId);
    else if (r.outcome === 'unknown') unknown.push(r.chainId);
  }
  return { deployedOn, unknown };
}

/**
 * Cached lookup for an address's Safe deployments. Empty `deployedOn` and
 * empty `unknown` together means we confirmed the address is not a Safe on
 * any allowlisted chain (treat as EOA). Empty `deployedOn` with a non-empty
 * `unknown` means we couldn't fully probe — consumers should fall back to
 * the wallet's reported chainId rather than assume EOA.
 *
 * NOTE: Safe Transaction Service rejects lowercase addresses with HTTP 422
 * ("Checksum address validation failed"). The address must be passed in
 * its EIP-55-checksummed form. wagmi's `useAccount().address` is already
 * checksummed; we cache by the lowercased form for stable React Query
 * keys but pass the original to the endpoint.
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
    queryFn: () => probeAllChains(address as string),
    enabled: typeof address === 'string' && address.length > 0,
    // Safe deployments are stable for the lifetime of an address. A user
    // could deploy a Safe on a new chain mid-session in theory; fine to
    // miss that until reload.
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000, // 1 hour
    retry: (failureCount, error) => {
      // The probe never throws (it returns "unknown" on error). If we
      // got here, retry is unlikely to help.
      void error;
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
 *      wallet's chainId — fall back gracefully so a flaky Safe TX
 *      Service doesn't block sign-in.
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
