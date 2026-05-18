import {
  fallback,
  http,
  type Transport,
  ContractFunctionRevertedError,
  ContractFunctionExecutionError,
} from "viem";
import {
  recordRequest,
  recordResponse,
  recordCorsBlocked,
  recordAuthRejected,
  recordPoolExhausted,
  scheduleAutoRecovery,
  forceProbeChain,
  observabilityHandle,
  getDeniedEndpointsForChain,
} from "./rpcObservability";
import { RPC_POOLS, getPoolEndpoints } from "./poolEndpoints";

// Re-export so existing consumers (and tests) can import these from rpcPools
// without churn while the modules settle. `RPC_POOLS` and `getPoolEndpoints`
// are owned by `poolEndpoints.ts` (extracted to break the circular import
// rpcPools ↔ rpcObservability when the latter computes a pool-hash).
export { RPC_POOLS, getPoolEndpoints };

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

    // Composition-time filter: drop URLs that hydrate() seeded as terminal
    // (cors-blocked / auth-rejected). This is what gives warm reloads their
    // payoff — endpoints the previous session learned were bad never get
    // contacted on the next page load until the F10 scheduler tries them.
    //
    // Edge case: every endpoint is denied. Fall back to the full pool rather
    // than constructing a zero-endpoint fallback (which would throw inside
    // viem). The pool-exhausted banner will surface naturally on actual
    // request failure, and forceProbeChain (Retry button) can recover.
    // This is the documented R2 exception in the plan.
    const denied = getDeniedEndpointsForChain(chainId);
    const allowedEndpoints = endpoints.filter((url) => !denied.has(url));
    const activeEndpoints =
      allowedEndpoints.length > 0 ? allowedEndpoints : endpoints;
    if (allowedEndpoints.length === 0 && denied.size > 0) {
      console.warn(
        `[rpcPools] All endpoints for chain ${chainId} denied at compose time — using full pool with banner state.`,
      );
    }

    // observabilityHandle.register below registers the FULL set (including
    // denied endpoints) so the banner state and F10 scheduler still see the
    // complete picture. The filter only affects which transports viem's
    // fallback walks at request time.
    const childTransports = activeEndpoints.map((url) =>
      http(url, {
        // retryCount: 1 (down from 3) per plan 2026-05-18-001 to cut the
        // worst-case per-endpoint amplifier from (1 + 3) to (1 + 1) attempts.
        // Construction-time wins over the runtime-zeroed value fallback
        // passes — verified at node_modules/viem/_esm/clients/transports/
        // http.js:15 (`const retryCount = config.retryCount ?? retryCount_`).
        // viem's Retry-After handling still fires on the single retry per
        // the `shouldRetry` whitelist in node_modules/viem/_esm/utils/
        // buildRequest.js (covers 408/413/429/500/502/503/504).
        retryCount: 1,
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
    // Index into `activeEndpoints` (the filtered set used to build
    // childTransports) — NOT `endpoints` (which would be misaligned when
    // any URL was filtered out).
    const wrappedTransports = childTransports.map((t, idx) =>
      wrapWithFetchErrorObserver(t, chainId, activeEndpoints[idx]),
    );

    // Rank disabled per plan 2026-05-18-001 (production-consensus prior art:
    // Uniswap, Reown AppKit, Aave, Sushiswap, Dyad, gnars all run with
    // rank: false). Composition is deterministic and ordered most-trusted-
    // first in `poolEndpoints.ts`. Endpoint health feeds the pool from
    // `rpcObservability`'s terminal-state set via `getDeniedEndpointsForChain`
    // (filter applied at compose time — see filter block above this fallback
    // call once U5 lands; pre-U5 this comment is forward-looking).
    //
    // `observabilityHandle.register` below still uses `eth_blockNumber` as
    // the probe method via `probeEndpoint`; that path is used by
    // `forceProbeChain` (Retry button) and `scheduleAutoRecovery`, not by
    // any per-call ranking.
    const fallbackTransport = fallback(wrappedTransports, {
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
 * Returns a Transport whose underlying pool (and rank scheduler) is only
 * constructed on the first `.request()` call. Use this for chains that are
 * NOT touched on the initial page load (e.g. the user's wallet hasn't
 * switched to them and no read path needs them yet).
 *
 * Why this matters on cold boot:
 *   buildChainTransport composes `fallback({ rank: { interval: 30s, ... } })`,
 *   and viem's fallback starts its rank probing as soon as the transport
 *   factory is invoked (which wagmi does once per chain when it builds the
 *   public client for each entry in `transports`). With 7 chains × ~6 pool
 *   endpoints, that's ~40 `eth_blockNumber` probes flying within a second of
 *   page load — pure waste for chains nothing on the page reads from.
 *
 * The synthetic `config` returned here exposes only metadata; the rank
 * scheduler does not spin up until a caller actually performs an RPC.
 */
export function buildLazyChainTransport(chainId: number): Transport {
  return (transportConfig) => {
    let resolved: ReturnType<Transport> | null = null;
    const ensure = (): ReturnType<Transport> => {
      if (!resolved) {
        resolved = buildChainTransport(chainId)(transportConfig);
      }
      return resolved;
    };
    const lazyRequest: ReturnType<Transport>["request"] = ((args: any, opts?: any) =>
      ensure().request(args, opts)) as ReturnType<Transport>["request"];
    return {
      config: {
        key: `lazy-${chainId}`,
        name: `Lazy chain ${chainId}`,
        type: "lazy",
        retryCount: 0,
        retryDelay: 150,
        request: lazyRequest,
        timeout: undefined,
      } as unknown as ReturnType<Transport>["config"],
      request: lazyRequest,
      value: undefined,
    };
  };
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
