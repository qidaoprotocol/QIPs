/**
 * RPC observability store — trimmed v1 surface.
 *
 * Records, per chain and per endpoint, only what U4's RpcPoolExhaustedError,
 * U5's banner, and the F10 auto-recovery scheduler need:
 *   - state ('unknown' | 'healthy' | 'cooling' | 'cors-blocked' | 'auth-rejected')
 *   - lastFailure ({ ts, status?, message, retryAfterMs? })
 *   - demotedAt (when the endpoint entered a terminal state — used by F10)
 *   - hadOkSample (used by the CORS heuristic's "never had ok=true" gate)
 *
 * Sample buffers, in-flight counters, cumulative totals, and the
 * useRpcObservability React hook are deferred to follow-up. v1 supplies only
 * the state and event-emit surface that v1 consumers need.
 *
 * Auto-recovery schedule (F10): cors-blocked / auth-rejected endpoints are
 * re-probed at 1h, 6h, 24h after demotedAt. A successful auto-probe promotes
 * back to healthy; a failure resets the schedule.
 */

import { base, baseSepolia, mainnet, polygon, optimism, gnosis, arbitrum } from "viem/chains";

export type EndpointState =
  | "unknown"
  | "healthy"
  | "cooling"
  | "cors-blocked"
  | "auth-rejected";

export interface EndpointLastFailure {
  readonly ts: number;
  readonly status?: number;
  readonly message: string;
  readonly retryAfterMs?: number;
}

export interface EndpointHealth {
  state: EndpointState;
  lastFailure?: EndpointLastFailure;
  demotedAt?: number;
  hadOkSample: boolean;
  totals: { ok: number; fail: number };
}

const TERMINAL_STATES = new Set<EndpointState>(["cors-blocked", "auth-rejected"]);

const AUTO_RECOVERY_DELAYS_MS = [
  60 * 60 * 1000, // 1h
  6 * 60 * 60 * 1000, // 6h
  24 * 60 * 60 * 1000, // 24h
] as const;

const CHAIN_LABELS: Record<number, string> = {
  [base.id]: "Base",
  [baseSepolia.id]: "Base Sepolia",
  [mainnet.id]: "Ethereum",
  [polygon.id]: "Polygon",
  [optimism.id]: "Optimism",
  [gnosis.id]: "Gnosis",
  [arbitrum.id]: "Arbitrum",
};

export function chainLabel(chainId: number): string {
  return CHAIN_LABELS[chainId] ?? `chain ${chainId}`;
}

/** Per-chain registration carrying the per-endpoint probe entry-point. */
interface ChainRegistration {
  endpoints: readonly string[];
  probeEndpoint: (url: string) => Promise<unknown>;
}

interface State {
  chains: Map<number, Map<string, EndpointHealth>>;
  registrations: Map<number, ChainRegistration>;
  recoveryTimers: Map<string, ReturnType<typeof setTimeout>>; // key = chainId::url
  exhaustedChains: Set<number>;
  inFlightProbes: Map<number, boolean>;
}

const state: State = {
  chains: new Map(),
  registrations: new Map(),
  recoveryTimers: new Map(),
  exhaustedChains: new Set(),
  inFlightProbes: new Map(),
};

type EventName =
  | "endpoint:state-change"
  | "pool:exhausted"
  | "pool:recovered"
  | "probe:started"
  | "probe:finished";

type Listener = (payload: unknown) => void;
const listeners = new Map<EventName, Set<Listener>>();

function emit(event: EventName, payload: unknown): void {
  const subs = listeners.get(event);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn(payload);
    } catch (err) {
      // A listener throw must not corrupt observability state for other
      // subscribers. Log and continue.
      console.error("[rpcObservability] listener threw", err);
    }
  }
}

export function subscribe(event: EventName, fn: Listener): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  return () => listeners.get(event)!.delete(fn);
}

function ensureEndpoint(chainId: number, url: string): EndpointHealth {
  let chain = state.chains.get(chainId);
  if (!chain) {
    chain = new Map();
    state.chains.set(chainId, chain);
  }
  let h = chain.get(url);
  if (!h) {
    h = {
      state: "unknown",
      hadOkSample: false,
      totals: { ok: 0, fail: 0 },
    };
    chain.set(url, h);
  }
  return h;
}

function setState(chainId: number, url: string, next: EndpointState): boolean {
  const h = ensureEndpoint(chainId, url);
  if (h.state === next) return false;
  h.state = next;
  if (TERMINAL_STATES.has(next)) {
    h.demotedAt = Date.now();
  } else if (h.state === "healthy") {
    h.demotedAt = undefined;
  }
  emit("endpoint:state-change", { chainId, url, state: next });
  return true;
}

export function recordRequest(_chainId: number, _url: string): void {
  // v1 does not track in-flight counters. The hook exists so a richer v2
  // observability layer can subscribe without changing the U1 transport
  // wiring.
}

interface ResponseSample {
  ok: boolean;
  status?: number;
  message?: string;
  retryAfterMs?: number;
}

export function recordResponse(chainId: number, url: string, sample: ResponseSample): void {
  const h = ensureEndpoint(chainId, url);
  if (sample.ok) {
    h.hadOkSample = true;
    h.totals.ok += 1;
    if (h.state !== "healthy" && !TERMINAL_STATES.has(h.state)) {
      setState(chainId, url, "healthy");
    }
    // A successful response from a terminal-state endpoint should NOT auto-
    // recover here — terminal states are exited only via the F10 scheduler
    // (which itself triggers a probe and on success flips state back) or
    // markEndpointHealthy(). This branch ignores success-after-terminal.
    maybeClearExhaustion(chainId);
    return;
  }
  h.totals.fail += 1;
  h.lastFailure = {
    ts: Date.now(),
    status: sample.status,
    message: sample.message ?? `HTTP ${sample.status ?? "?"}`,
    retryAfterMs: sample.retryAfterMs,
  };
  if (!TERMINAL_STATES.has(h.state)) {
    setState(chainId, url, "cooling");
  }
  checkPoolExhaustion(chainId);
}

/**
 * CORS heuristic: promote to terminal cors-blocked ONLY when the endpoint
 * has never produced an ok=true sample this session. Returns true iff the
 * endpoint was promoted to terminal (caller schedules auto-recovery).
 */
export function recordCorsBlocked(chainId: number, url: string, err: TypeError): boolean {
  const h = ensureEndpoint(chainId, url);
  h.totals.fail += 1;
  h.lastFailure = {
    ts: Date.now(),
    message: err.message || "fetch failed",
  };
  if (!h.hadOkSample) {
    setState(chainId, url, "cors-blocked");
    checkPoolExhaustion(chainId);
    return true;
  }
  // Endpoint was healthy at some point — treat as transient cooling.
  if (!TERMINAL_STATES.has(h.state)) {
    setState(chainId, url, "cooling");
  }
  checkPoolExhaustion(chainId);
  return false;
}

export function recordAuthRejected(
  chainId: number,
  url: string,
  detail: { status: number; retryAfterMs?: number },
): void {
  const h = ensureEndpoint(chainId, url);
  h.totals.fail += 1;
  h.lastFailure = {
    ts: Date.now(),
    status: detail.status,
    message: `HTTP ${detail.status} (auth rejected)`,
    retryAfterMs: detail.retryAfterMs,
  };
  setState(chainId, url, "auth-rejected");
  checkPoolExhaustion(chainId);
}

export function recordPoolExhausted(chainId: number): void {
  if (state.exhaustedChains.has(chainId)) return;
  state.exhaustedChains.add(chainId);
  emit("pool:exhausted", { chainId });
}

function checkPoolExhaustion(chainId: number): void {
  const chain = state.chains.get(chainId);
  if (!chain) return;
  const reg = state.registrations.get(chainId);
  if (!reg || reg.endpoints.length === 0) return;
  const allDown = reg.endpoints.every((url) => {
    const h = chain.get(url);
    return h !== undefined && h.state !== "healthy" && h.state !== "unknown";
  });
  if (allDown) recordPoolExhausted(chainId);
}

function maybeClearExhaustion(chainId: number): void {
  if (!state.exhaustedChains.has(chainId)) return;
  const chain = state.chains.get(chainId);
  if (!chain) return;
  const reg = state.registrations.get(chainId);
  if (!reg) return;
  const hasHealthy = reg.endpoints.some((url) => chain.get(url)?.state === "healthy");
  if (hasHealthy) {
    state.exhaustedChains.delete(chainId);
    emit("pool:recovered", { chainId });
  }
}

/** F10 auto-recovery scheduler. */
export function scheduleAutoRecovery(chainId: number, url: string): void {
  const key = `${chainId}::${url}`;
  // Clear any prior timer for this endpoint — fresh demotion resets the schedule.
  const prior = state.recoveryTimers.get(key);
  if (prior) clearTimeout(prior);

  const h = ensureEndpoint(chainId, url);
  const demotedAt = h.demotedAt ?? Date.now();
  // Always start at 1h on a fresh demotion. The schedule progresses 1h → 6h →
  // 24h on consecutive failures.
  scheduleAtIndex(chainId, url, key, demotedAt, 0);
}

function scheduleAtIndex(
  chainId: number,
  url: string,
  key: string,
  demotedAt: number,
  attemptIndex: number,
): void {
  const idx = Math.min(attemptIndex, AUTO_RECOVERY_DELAYS_MS.length - 1);
  const delay = AUTO_RECOVERY_DELAYS_MS[idx];
  const timer = setTimeout(() => {
    runAutoRecoveryProbe(chainId, url, key, demotedAt, attemptIndex).catch((err) => {
      console.error("[rpcObservability] auto-recovery probe threw", err);
    });
  }, delay);
  state.recoveryTimers.set(key, timer);
}

async function runAutoRecoveryProbe(
  chainId: number,
  url: string,
  key: string,
  demotedAt: number,
  attemptIndex: number,
): Promise<void> {
  state.recoveryTimers.delete(key);
  const reg = state.registrations.get(chainId);
  if (!reg) return;
  const h = ensureEndpoint(chainId, url);
  if (!TERMINAL_STATES.has(h.state)) return; // already recovered another way
  try {
    await reg.probeEndpoint(url);
    // Success: promote back to healthy and clear the schedule.
    h.hadOkSample = true;
    h.totals.ok += 1;
    setState(chainId, url, "healthy");
    maybeClearExhaustion(chainId);
  } catch (err) {
    h.totals.fail += 1;
    h.lastFailure = {
      ts: Date.now(),
      message: err instanceof Error ? err.message : "auto-recovery probe failed",
    };
    // Reschedule at the next step. The original demotedAt is preserved so
    // the timeline reads (1h-then-fail) → (next 6h-from-now) → ...
    scheduleAtIndex(chainId, url, key, demotedAt, attemptIndex + 1);
  }
}

/**
 * Force one round of probes against every cooling/unknown endpoint on a chain.
 * Skips terminal endpoints — those require markEndpointHealthy() first.
 *
 * Returns when either at least one endpoint comes back healthy, or every
 * non-terminal endpoint has been probed once. The probe-finished event fires
 * regardless so subscribers (the U5 banner) can re-enable their UI.
 */
export async function forceProbeChain(chainId: number): Promise<void> {
  const reg = state.registrations.get(chainId);
  if (!reg) return;
  if (state.inFlightProbes.get(chainId)) return; // de-dupe concurrent presses
  state.inFlightProbes.set(chainId, true);
  emit("probe:started", { chainId });
  try {
    const chain = state.chains.get(chainId);
    const targets = reg.endpoints.filter((url) => {
      const h = chain?.get(url);
      return !h || (h.state !== "cors-blocked" && h.state !== "auth-rejected");
    });
    await Promise.allSettled(
      targets.map(async (url) => {
        try {
          await reg.probeEndpoint(url);
          const h = ensureEndpoint(chainId, url);
          h.hadOkSample = true;
          h.totals.ok += 1;
          setState(chainId, url, "healthy");
        } catch (err) {
          const h = ensureEndpoint(chainId, url);
          h.totals.fail += 1;
          h.lastFailure = {
            ts: Date.now(),
            message: err instanceof Error ? err.message : "probe failed",
          };
          if (!TERMINAL_STATES.has(h.state)) {
            setState(chainId, url, "cooling");
          }
        }
      }),
    );
    maybeClearExhaustion(chainId);
  } finally {
    state.inFlightProbes.set(chainId, false);
    emit("probe:finished", { chainId });
  }
}

export function isProbeInFlight(chainId: number): boolean {
  return state.inFlightProbes.get(chainId) === true;
}

/**
 * Manual operator override. Lifts terminal state on a single endpoint and
 * re-probes immediately. Cancels any pending auto-recovery timer for that
 * endpoint.
 */
export function markEndpointHealthy(url: string): void {
  for (const [chainId, chain] of state.chains.entries()) {
    if (!chain.has(url)) continue;
    const key = `${chainId}::${url}`;
    const timer = state.recoveryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      state.recoveryTimers.delete(key);
    }
    const h = chain.get(url)!;
    h.state = "unknown";
    h.demotedAt = undefined;
    emit("endpoint:state-change", { chainId, url, state: "unknown" });
    // Fire-and-forget probe to populate state quickly.
    forceProbeChain(chainId).catch(() => {
      /* probe errors are recorded inside forceProbeChain */
    });
    return;
  }
}

/**
 * Read-only snapshot for window.__qipsRpc inspection. Returns a deep clone
 * that's safe to mutate from the console without corrupting state.
 */
export function getSnapshot(): Record<number, Record<string, EndpointHealth>> {
  const out: Record<number, Record<string, EndpointHealth>> = {};
  for (const [chainId, chain] of state.chains.entries()) {
    const inner: Record<string, EndpointHealth> = {};
    for (const [url, h] of chain.entries()) {
      inner[url] = {
        state: h.state,
        lastFailure: h.lastFailure ? { ...h.lastFailure } : undefined,
        demotedAt: h.demotedAt,
        hadOkSample: h.hadOkSample,
        totals: { ...h.totals },
      };
    }
    out[chainId] = inner;
  }
  return out;
}

/** Return the per-endpoint failure metadata for a chain in a stable shape
 *  consumable by RpcPoolExhaustedError.attempted[]. */
export const observabilityHandle = {
  register(chainId: number, registration: ChainRegistration): void {
    state.registrations.set(chainId, registration);
  },
  snapshotAttempted(chainId: number): { url: string; state: EndpointState; status?: number; message?: string }[] {
    const chain = state.chains.get(chainId);
    const reg = state.registrations.get(chainId);
    const urls = reg?.endpoints ?? (chain ? Array.from(chain.keys()) : []);
    return urls.map((url) => {
      const h = chain?.get(url);
      return {
        url,
        state: h?.state ?? "unknown",
        status: h?.lastFailure?.status,
        message: h?.lastFailure?.message,
      };
    });
  },
};

/**
 * Attach the dev-only window helper. Idempotent — safe to call multiple times.
 *
 * Gated on process.env.NODE_ENV !== "production" so Vite's prod bundle drops
 * the attachment via dead-code elimination (Vite substitutes the value at
 * build time). The codebase already uses this idiom in src/config/env.ts;
 * matching it keeps the production tree-shake behavior consistent.
 */
export function attachDebugGlobal(): void {
  try {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") return;
    if (typeof window === "undefined") return;
    (window as unknown as { __qipsRpc?: unknown }).__qipsRpc = {
      getSnapshot,
      forceProbe: forceProbeChain,
      markEndpointHealthy,
      subscribe,
    };
  } catch {
    // No-op
  }
}

/** Reset module state. Test-only; not used in production. */
export function __resetForTests(): void {
  state.chains.clear();
  state.registrations.clear();
  for (const t of state.recoveryTimers.values()) clearTimeout(t);
  state.recoveryTimers.clear();
  state.exhaustedChains.clear();
  state.inFlightProbes.clear();
  listeners.clear();
}
