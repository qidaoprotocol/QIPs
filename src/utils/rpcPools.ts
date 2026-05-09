import {
  fallback,
  http,
  type Transport,
  ContractFunctionRevertedError,
  ContractFunctionExecutionError,
} from "viem";
import {
  arbitrum,
  base,
  baseSepolia,
  gnosis,
  mainnet,
  optimism,
  polygon,
} from "viem/chains";
import {
  recordRequest,
  recordResponse,
  recordCorsBlocked,
  recordAuthRejected,
  recordPoolExhausted,
  scheduleAutoRecovery,
  forceProbeChain,
  observabilityHandle,
} from "./rpcObservability";

/**
 * Per-chain RPC endpoint defaults, ordered most-trusted-first.
 *
 * The cold-start window matters: viem's fallback rank fires once on transport
 * creation, then sleeps `rank.interval` (30s) before re-probing. Until at
 * least one full probe cycle completes (~1-2s) the active transport is the
 * first entry in this list. Until ~5 minutes pass to fill the sampleCount
 * window the rank's stability score is binary, so input order continues to
 * matter. Order each chain by the most reliable / lowest-latency endpoint
 * first.
 *
 * Polygon defaults explicitly EXCLUDE polygon-rpc.com per the
 * polygon-psm-rpc-401-2026-04-22 learning.
 */
export const RPC_POOLS: Record<number, readonly string[]> = {
  [base.id]: [
    "https://mainnet.base.org",
    "https://base.publicnode.com",
    "https://base-mainnet.public.blastapi.io",
    "https://1rpc.io/base",
  ],
  [baseSepolia.id]: [
    "https://sepolia.base.org",
    "https://base-sepolia.publicnode.com",
  ],
  [mainnet.id]: [
    "https://eth.llamarpc.com",
    "https://ethereum.publicnode.com",
    "https://1rpc.io/eth",
    "https://eth-mainnet.public.blastapi.io",
  ],
  [polygon.id]: [
    "https://polygon.drpc.org",
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.llamarpc.com",
    "https://1rpc.io/matic",
  ],
  [optimism.id]: [
    "https://mainnet.optimism.io",
    "https://optimism.publicnode.com",
    "https://1rpc.io/op",
  ],
  [arbitrum.id]: [
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum.publicnode.com",
    "https://1rpc.io/arb",
  ],
  [gnosis.id]: [
    "https://rpc.gnosischain.com",
    "https://gnosis.publicnode.com",
  ],
};

const ENV_KEY_BY_CHAIN_ID: Record<number, { single: string; list: string }> = {
  [base.id]: { single: "VITE_BASE_RPC_URL", list: "VITE_BASE_RPC_URLS" },
  [baseSepolia.id]: {
    single: "VITE_BASE_SEPOLIA_RPC_URL",
    list: "VITE_BASE_SEPOLIA_RPC_URLS",
  },
  [mainnet.id]: { single: "VITE_MAINNET_RPC_URL", list: "VITE_MAINNET_RPC_URLS" },
  [polygon.id]: { single: "VITE_POLYGON_RPC_URL", list: "VITE_POLYGON_RPC_URLS" },
  [optimism.id]: {
    single: "VITE_OPTIMISM_RPC_URL",
    list: "VITE_OPTIMISM_RPC_URLS",
  },
  [arbitrum.id]: {
    single: "VITE_ARBITRUM_RPC_URL",
    list: "VITE_ARBITRUM_RPC_URLS",
  },
  [gnosis.id]: { single: "VITE_GNOSIS_RPC_URL", list: "VITE_GNOSIS_RPC_URLS" },
};

function readEnv(key: string): string | undefined {
  // Mirrors src/config/env.ts:getEnvVar exactly. The optional-chaining variant
  // I tried first does not consistently surface VITE_* env vars in Vite's
  // dev pipeline; the explicit typeof guard does.
  let value: string | undefined;
  try {
    if (typeof import.meta !== "undefined" && (import.meta as unknown as { env?: Record<string, string> }).env) {
      value = (import.meta as unknown as { env: Record<string, string> }).env[key];
    }
  } catch {
    // import.meta is unavailable in some SSR / test contexts.
  }
  if (!value && typeof process !== "undefined" && process.env?.[key]) {
    value = process.env[key];
  }
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function readBoolEnv(key: string): boolean {
  return readEnv(key) === "true";
}

/**
 * Resolve the endpoint list for a chain.
 *
 * Precedence (top wins):
 *   1. VITE_<CHAIN>_RPC_URLS (comma-split list).
 *   2. VITE_<CHAIN>_RPC_URL (single override; treated as a strict one-element
 *      pool, NOT appended to defaults).
 *   3. RPC_POOLS[chainId] defaults.
 *
 * Local-mode short-circuit: when VITE_LOCAL_MODE=true and the singular
 * VITE_BASE_RPC_URL points at localhost, return only that one URL for base.id
 * regardless of the pool. Preserves the Anvil fork pattern.
 */
export function getPoolEndpoints(chainId: number): string[] {
  const envKeys = ENV_KEY_BY_CHAIN_ID[chainId];
  const localMode = readBoolEnv("VITE_LOCAL_MODE");
  const singleBaseRpc = readEnv("VITE_BASE_RPC_URL");
  if (
    chainId === base.id &&
    localMode &&
    singleBaseRpc &&
    (singleBaseRpc.includes("localhost") || singleBaseRpc.includes("127.0.0.1"))
  ) {
    return [singleBaseRpc];
  }
  if (envKeys) {
    const list = readEnv(envKeys.list);
    if (list) {
      return list
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);
    }
    const single = readEnv(envKeys.single);
    if (single) return [single];
  }
  const defaults = RPC_POOLS[chainId];
  return defaults ? [...defaults] : [];
}

/**
 * Memoized module-scope cache so every consumer of buildChainTransport for
 * the same chainId+override receives the SAME Transport reference. This is
 * load-bearing: viem's fallback rank scheduler self-recurses forever once
 * started, so multiple instances would mean N parallel rank loops that
 * collectively probe every endpoint at N× the configured rate. The QIPs
 * codebase has 12 QCIClient instantiation sites; without memoization, an
 * average user session would spawn dozens of parallel rank loops and likely
 * trigger the rate-limiting this module is meant to prevent.
 */
const transportCache = new Map<string, Transport>();

function shouldThrowFromFallback(error: Error): boolean {
  // Contract reverts must propagate unchanged so callers can branch on the
  // typed error rather than seeing RpcPoolExhaustedError after the outer
  // wrapper retries every endpoint.
  if (error instanceof ContractFunctionRevertedError) return true;
  if (error instanceof ContractFunctionExecutionError) return true;
  // Walk the cause chain — viem nests ContractFunction* errors inside higher
  // wrappers like InvalidParamsRpcError in some surfaces.
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error && cause !== error) return shouldThrowFromFallback(cause);
  return false;
}

const CORS_ERROR_PATTERN = /failed to fetch|networkerror|load failed/i;

interface BuildChainTransportOptions {
  /**
   * Per-call single-URL override. When set, the factory returns a plain
   * http(rpcUrlOverride) transport (no pool, no rank, no observability).
   * Used by QCIClient call sites that pass an explicit rpcUrl arg (Anvil
   * forks, per-call routing). The override is part of the cache key so
   * concurrent callers with different overrides each get their own transport.
   */
  rpcUrlOverride?: string;
}

/**
 * Returns a viem Transport for the given chain, memoized by (chainId, override).
 *
 * Composition for the pool path:
 *   fallback(
 *     pool.map(url => http(url, { retryCount: 3, retryDelay: 150,
 *                                 onFetchRequest, onFetchResponse })),
 *     { rank: { ping: eth_blockNumber, interval: 30s, sampleCount: 10,
 *               weights: { latency: 0.3, stability: 0.7 }, timeout: 1500 },
 *       retryCount: 0,            // per-http retry honors Retry-After;
 *                                 // fallback only does cross-endpoint failover
 *       shouldThrow: ContractFunction* }
 *   )
 *
 * The override path returns a single http(rpcUrlOverride) and does not register
 * with the rank scheduler or observability — local Anvil dev typically uses a
 * single host.
 */
export function buildChainTransport(
  chainId: number,
  options: BuildChainTransportOptions = {},
): Transport {
  const cacheKey = options.rpcUrlOverride
    ? `${chainId}::override::${options.rpcUrlOverride}`
    : `${chainId}::pool`;
  const cached = transportCache.get(cacheKey);
  if (cached) return cached;

  let transport: Transport;
  if (options.rpcUrlOverride) {
    transport = http(options.rpcUrlOverride);
  } else {
    const endpoints = getPoolEndpoints(chainId);
    if (endpoints.length === 0) {
      throw new Error(
        `No RPC pool configured for chain ${chainId}. Add an entry to RPC_POOLS in src/utils/rpcPools.ts or set VITE_<CHAIN>_RPC_URL[S].`,
      );
    }
    const childTransports = endpoints.map((url) =>
      http(url, {
        retryCount: 3,
        retryDelay: 150,
        onFetchRequest: () => {
          recordRequest(chainId, url);
        },
        onFetchResponse: async (response) => {
          // Read headers without consuming body. Clone is safe; response is
          // not yet consumed by viem at the time of this hook.
          const status = response.status;
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterMs = parseRetryAfterMs(retryAfterHeader);

          if (status >= 200 && status < 300) {
            recordResponse(chainId, url, { ok: true, status });
            return;
          }

          if (status === 403 && retryAfterMs == null) {
            // Auth-rejected: revoked API key shape. Terminal state.
            recordAuthRejected(chainId, url, { status, retryAfterMs });
            scheduleAutoRecovery(chainId, url);
            return;
          }

          recordResponse(chainId, url, {
            ok: false,
            status,
            retryAfterMs,
            message: `HTTP ${status}`,
          });
        },
      }),
    );

    // Wrap each http() to convert TypeError-shaped fetch failures into the
    // observability state machine (cors-blocked vs cooling). viem's http()
    // currently propagates the TypeError directly out of the request promise;
    // we catch it via a thin wrapper transport that intercepts the error and
    // records before re-throwing. The fallback transport then sees a normal
    // rejection and moves on.
    const wrappedTransports = childTransports.map((t, idx) =>
      wrapWithFetchErrorObserver(t, chainId, endpoints[idx]),
    );

    const fallbackTransport = fallback(wrappedTransports, {
      rank: {
        interval: 30_000,
        sampleCount: 10,
        timeout: 1500,
        weights: { latency: 0.3, stability: 0.7 },
        ping: ({ transport: pingTransport }) =>
          pingTransport.request({ method: "eth_blockNumber" }),
      },
      retryCount: 0,
      shouldThrow: shouldThrowFromFallback,
    });

    // Outer wrapper that converts viem's aggregate "all transports failed"
    // shape into a typed RpcPoolExhaustedError carrying per-endpoint
    // failure metadata from the observability store. Lives in U4 (extends
    // this module); for now this is the bare fallback.
    transport = wrapWithPoolExhausted(fallbackTransport, chainId);

    // Register this chain with the observability layer so forceProbe and
    // auto-recovery probes can dispatch eth_blockNumber against the same
    // child transports. The handle is per-chain.
    observabilityHandle.register(chainId, {
      endpoints,
      probeEndpoint: async (url) => {
        // Use a single-endpoint http() so the probe's retry/observability
        // pipeline is identical to the live pool's per-endpoint path.
        const probe = http(url, { retryCount: 0 });
        const client = probe({ chain: undefined, retryCount: 0, timeout: 5000 });
        await client.request({ method: "eth_blockNumber" });
      },
    });
  }

  transportCache.set(cacheKey, transport);
  return transport;
}

/**
 * Reset the memoized transport cache. Test-only utility; production code MUST
 * NOT call this. Resetting between caller sessions would defeat the point of
 * memoization (rank-loop multiplication).
 */
export function __resetTransportCacheForTests(): void {
  transportCache.clear();
}

/**
 * Parse Retry-After per RFC 7231 §7.1.3. Accepts delta-seconds (integer) or
 * HTTP-date. Returns null when the header is absent or unparseable.
 *
 * Note: viem's built-in retry layer (`buildRequest.ts:247-263`) only handles
 * delta-seconds via Number.parseInt. The HTTP-date branch here is purely for
 * observability — viem itself falls back to exponential backoff on date-form
 * Retry-After. The HTTP-date implementation gap is captured in the plan's
 * deferred-follow-up.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  const ts = Date.parse(trimmed);
  if (Number.isFinite(ts)) {
    const delta = ts - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

/**
 * Wrap a viem http transport so fetch-layer TypeErrors (CORS, network, etc.)
 * are routed to the observability layer's CORS-detection rule before being
 * re-thrown so the outer fallback can move on.
 *
 * Detection rule (per F2 of the doc-review): promote to terminal cors-blocked
 * only when (a) the error matches the cross-vendor regex AND (b) the endpoint
 * has never produced an ok=true sample this session. Errors of the same shape
 * on previously-successful endpoints stay in cooling.
 */
function wrapWithFetchErrorObserver(
  inner: Transport,
  chainId: number,
  url: string,
): Transport {
  return (config) => {
    const innerInstance = inner(config);
    return {
      ...innerInstance,
      async request(args, opts) {
        try {
          return await innerInstance.request(args, opts);
        } catch (err) {
          if (err instanceof TypeError && CORS_ERROR_PATTERN.test(err.message)) {
            const promotedToTerminal = recordCorsBlocked(chainId, url, err);
            if (promotedToTerminal) {
              scheduleAutoRecovery(chainId, url);
            }
          }
          throw err;
        }
      },
    };
  };
}

/**
 * Outer wrapper that converts viem's aggregate "all transports failed" error
 * into a typed RpcPoolExhaustedError with per-endpoint failure metadata. The
 * actual error class lives in U4 (./RpcPoolExhaustedError); this module
 * imports lazily to avoid a circular import.
 */
function wrapWithPoolExhausted(inner: Transport, chainId: number): Transport {
  return (config) => {
    const innerInstance = inner(config);
    return {
      ...innerInstance,
      async request(args, opts) {
        try {
          return await innerInstance.request(args, opts);
        } catch (err) {
          if (isAllTransportsFailedError(err)) {
            // Lazy import keeps the cycle clean: rpcPools imports
            // observability and the error class; the error class is a leaf.
            const { RpcPoolExhaustedError } = await import("./RpcPoolExhaustedError");
            const attempted = observabilityHandle.snapshotAttempted(chainId);
            recordPoolExhausted(chainId);
            throw new RpcPoolExhaustedError(chainId, attempted, err);
          }
          throw err;
        }
      },
    };
  };
}

/**
 * Pattern-match viem's aggregate-error shape. viem does not expose a typed
 * "all transports failed" error class, so this checks by message prefix and
 * by the presence of an `errors` array carrying child errors. The shape was
 * inspected against viem 2.30.6 (`node_modules/viem/clients/transports/fallback.ts`);
 * a viem upgrade may change the shape — the failure mode is "no longer
 * recognized as pool-exhaustion, the original viem error propagates", which
 * is degraded but not catastrophic.
 */
function isAllTransportsFailedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown; errors?: unknown };
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    if (typeof e.message === "string" && /transport.*fail|all transports/i.test(e.message)) {
      return true;
    }
  }
  return false;
}

// Re-export the chain-level forceProbe helper so callers can reach it via
// rpcPools too — the observability module owns the actual implementation.
export { forceProbeChain };
