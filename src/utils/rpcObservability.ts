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
import { RPC_POOLS, getPoolEndpoints } from "./poolEndpoints";

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
  } else if (next === "healthy") {
    h.demotedAt = undefined;
  }
  emit("endpoint:state-change", { chainId, url, state: next });
  scheduleDehydrate();
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
    // Pre-seed unknown entries for all registered endpoints so the snapshot
    // reflects the full pool the moment registration completes. Without this,
    // when hydrate() restores a terminal entry for one URL before any other
    // URL has been touched, the snapshot has exactly one cors-blocked entry
    // and `deriveExhaustedFromSnapshot` in RpcStatusBanner concludes "all
    // known endpoints are dead → pool exhausted" — producing a banner flash
    // on every cold load with persisted health. ensureEndpoint is idempotent
    // so already-hydrated terminal entries are unchanged.
    for (const url of registration.endpoints) {
      ensureEndpoint(chainId, url);
    }
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
export function __resetForTests(opts: { keepStorage?: boolean } = {}): void {
  state.chains.clear();
  state.registrations.clear();
  for (const t of state.recoveryTimers.values()) clearTimeout(t);
  state.recoveryTimers.clear();
  state.exhaustedChains.clear();
  state.inFlightProbes.clear();
  listeners.clear();
  if (dehydrateTimer) {
    clearTimeout(dehydrateTimer);
    dehydrateTimer = null;
  }
  if (!opts.keepStorage && typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem(PERSIST_KEY);
    } catch {
      // ignore
    }
  }
}

// ─── Endpoint-health persistence ────────────────────────────────────────────
//
// Survives page loads by writing terminal-state endpoints (and recent healthy
// ones) to localStorage. On the next session, `hydrate()` reads the blob,
// validates it against the current pool composition (via `poolHash`), and
// reseeds in-memory state so the cold reload skips re-discovering the same
// bad endpoint.
//
// Asymmetric TTL: positive (healthy) entries live 24h; terminal entries live
// 1h to match `AUTO_RECOVERY_DELAYS_MS[0]` so a session ending just before
// the first F10 probe doesn't pin the endpoint as bad indefinitely.
//
// pool-hash invalidation: when `RPC_POOLS` or any env override changes, the
// computed hash differs from the persisted one and the entire blob is
// dropped. Stale URLs that survive a partial pool edit are also filtered.
//
// Plan: docs/plans/2026-05-18-001-fix-base-rpc-pool-tuning-plan.md

const PERSIST_KEY = "qips:rpc-health:v1";
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const TERMINAL_TTL_MS = 60 * 60 * 1000; // 1h — matches AUTO_RECOVERY_DELAYS_MS[0]
const DEHYDRATE_THROTTLE_MS = 1000;

type PersistableState = "healthy" | "cors-blocked" | "auth-rejected";

interface PersistedEntry {
  state: PersistableState;
  demotedAt?: number;
  hadOkSample: boolean;
}

interface PersistedBlob {
  poolHash: string;
  ts: number;
  entries: Record<number, Record<string, PersistedEntry>>;
}

/**
 * cyrb53 — small, deterministic, sync 53-bit hash. MIT-licensed.
 * Source: https://github.com/bryc/code/blob/master/jshash/hashes/cyrb53.js
 *
 * Cryptographic strength is unnecessary — we need "any pool edit produces a
 * different hash," not collision resistance. SubtleCrypto.digest is async
 * and would break the sync hydrate path.
 */
function cyrb53(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const result = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return result.toString(16);
}

/**
 * Compute a stable hash of the source-of-truth pool composition.
 *
 * Uses RPC_POOLS + env overrides via getPoolEndpoints(chainId) — NOT
 * state.registrations, because registrations don't exist yet at hydrate
 * time. The canonical boot order has registrations happening later, inside
 * buildChainTransport.
 */
function getPoolHash(): string {
  const chainIds = Object.keys(RPC_POOLS).map(Number).sort((a, b) => a - b);
  const payload: Record<number, string[]> = {};
  for (const chainId of chainIds) {
    const endpoints = [...getPoolEndpoints(chainId)].sort();
    payload[chainId] = endpoints;
  }
  return cyrb53(JSON.stringify(payload));
}

let dehydrateTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDehydrate(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  if (dehydrateTimer) return; // a write is already pending; final write captures latest state
  dehydrateTimer = setTimeout(() => {
    dehydrateTimer = null;
    dehydrate();
  }, DEHYDRATE_THROTTLE_MS);
}

/**
 * Write current persistable state to localStorage. Soft-fails on quota or
 * SSR-style absence of `localStorage`. Normally invoked via the throttled
 * `scheduleDehydrate`; tests can call directly.
 */
export function dehydrate(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const entries: Record<number, Record<string, PersistedEntry>> = {};
    for (const [chainId, chain] of state.chains.entries()) {
      const inner: Record<string, PersistedEntry> = {};
      for (const [url, h] of chain.entries()) {
        if (
          h.state === "healthy" ||
          h.state === "cors-blocked" ||
          h.state === "auth-rejected"
        ) {
          inner[url] = {
            state: h.state,
            demotedAt: h.demotedAt,
            hadOkSample: h.hadOkSample,
          };
        }
      }
      if (Object.keys(inner).length > 0) entries[chainId] = inner;
    }
    const blob: PersistedBlob = {
      poolHash: getPoolHash(),
      ts: Date.now(),
      entries,
    };
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(blob));
  } catch {
    // Quota errors, JSON failures — swallow. Persistence is best-effort;
    // missing it does not break in-memory observability.
  }
}

/**
 * Test-only helper to synchronously flush the throttled dehydrate timer.
 * Production paths rely on the setTimeout firing naturally.
 */
export function flushDehydrateForTests(): void {
  if (dehydrateTimer) {
    clearTimeout(dehydrateTimer);
    dehydrateTimer = null;
  }
  dehydrate();
}

function isPersistedEntryShape(value: unknown): value is PersistedEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.state === "healthy" ||
      v.state === "cors-blocked" ||
      v.state === "auth-rejected") &&
    (v.demotedAt === undefined || typeof v.demotedAt === "number") &&
    typeof v.hadOkSample === "boolean"
  );
}

function isPersistedBlobShape(value: unknown): value is PersistedBlob {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.poolHash !== "string" || typeof v.ts !== "number") return false;
  if (typeof v.entries !== "object" || v.entries === null) return false;
  // Don't deep-validate every entry — isPersistedEntryShape gates each entry
  // at hydrate time. Shape validation here just catches obvious corruption.
  return true;
}

/**
 * Restore terminal and recent-healthy endpoint state from localStorage.
 *
 * Canonical boot-order placement: called from `Web3Provider.tsx` at module
 * init BEFORE `attachDebugGlobal()` and BEFORE any `buildChainTransport`,
 * so `getDeniedEndpointsForChain` returns the seeded set when
 * `buildChainTransport` first composes its pool.
 *
 * Validates: versioned key (PERSIST_KEY), shape, top-level freshness
 * (24h cap), per-entry TTL (asymmetric), pool-hash match against current
 * `RPC_POOLS` + env. On any failure the blob is removed and hydration is a
 * silent no-op (this also covers private-mode browsers / quota errors).
 */
export function hydrate(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PERSIST_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemove();
    return;
  }
  if (!isPersistedBlobShape(parsed)) {
    safeRemove();
    return;
  }
  const blob = parsed;

  const now = Date.now();
  // Top-level freshness — blobs older than POSITIVE_TTL_MS are discarded
  // wholesale to avoid carrying ancient state forward.
  if (now - blob.ts > POSITIVE_TTL_MS) {
    safeRemove();
    return;
  }

  // Pool-composition hash check — invalidate on any RPC_POOLS or env edit.
  if (blob.poolHash !== getPoolHash()) {
    safeRemove();
    return;
  }

  for (const [chainIdStr, chainEntries] of Object.entries(blob.entries)) {
    const chainId = Number(chainIdStr);
    if (!Number.isFinite(chainId)) continue;
    const knownUrls = new Set(getPoolEndpoints(chainId));

    for (const [url, entry] of Object.entries(chainEntries)) {
      if (!isPersistedEntryShape(entry)) continue;
      // Stale URLs (no longer in the current pool) are silently dropped.
      if (!knownUrls.has(url)) continue;

      // Per-entry TTL.
      const entryAge = now - blob.ts;
      const isTerminal =
        entry.state === "cors-blocked" || entry.state === "auth-rejected";
      if (isTerminal && entryAge > TERMINAL_TTL_MS) continue;
      if (!isTerminal && entryAge > POSITIVE_TTL_MS) continue;

      _setStateFromHydration(chainId, url, entry);
    }
  }
}

function safeRemove(): void {
  try {
    window.localStorage.removeItem(PERSIST_KEY);
  } catch {
    // ignore
  }
}

/**
 * Internal: seed an endpoint's state from a persisted entry without
 * triggering the dehydrate throttle (would cause an immediate re-write of
 * what we just read) and, for terminal states, restart the F10 timer at
 * the correct elapsed offset.
 */
function _setStateFromHydration(
  chainId: number,
  url: string,
  entry: PersistedEntry,
): void {
  const h = ensureEndpoint(chainId, url);
  h.state = entry.state;
  h.hadOkSample = entry.hadOkSample;
  if (entry.demotedAt !== undefined) h.demotedAt = entry.demotedAt;
  // No emit, no dehydrate trigger — this is a hydration, not a transition.

  if (entry.state === "cors-blocked" || entry.state === "auth-rejected") {
    _restartF10TimerFromDemotedAt(chainId, url, entry.demotedAt ?? Date.now());
  }
}

/**
 * Restart the F10 auto-recovery scheduler at the slot whose cumulative delay
 * has not yet elapsed since `demotedAt`. Clamps at 0 (fire immediately) if
 * the entry sat past the final slot.
 */
function _restartF10TimerFromDemotedAt(
  chainId: number,
  url: string,
  demotedAt: number,
): void {
  const elapsed = Math.max(0, Date.now() - demotedAt);
  let cumulative = 0;
  for (let idx = 0; idx < AUTO_RECOVERY_DELAYS_MS.length; idx += 1) {
    cumulative += AUTO_RECOVERY_DELAYS_MS[idx];
    if (elapsed < cumulative) {
      const remaining = Math.max(0, cumulative - elapsed);
      _scheduleAtIndexWithDelay(chainId, url, demotedAt, idx, remaining);
      return;
    }
  }
  // Past the final slot — fire immediately at the last index.
  _scheduleAtIndexWithDelay(
    chainId,
    url,
    demotedAt,
    AUTO_RECOVERY_DELAYS_MS.length - 1,
    0,
  );
}

function _scheduleAtIndexWithDelay(
  chainId: number,
  url: string,
  demotedAt: number,
  attemptIndex: number,
  delayMs: number,
): void {
  const key = `${chainId}::${url}`;
  const prior = state.recoveryTimers.get(key);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => {
    runAutoRecoveryProbe(chainId, url, key, demotedAt, attemptIndex).catch((err) => {
      console.error("[rpcObservability] auto-recovery probe threw", err);
    });
  }, delayMs);
  state.recoveryTimers.set(key, timer);
}

/**
 * URLs in terminal state for the given chain. Used by `buildChainTransport`
 * (U5) to filter the pool composition before constructing `fallback(...)`.
 */
export function getDeniedEndpointsForChain(chainId: number): Set<string> {
  const out = new Set<string>();
  const chain = state.chains.get(chainId);
  if (!chain) return out;
  for (const [url, h] of chain.entries()) {
    if (h.state === "cors-blocked" || h.state === "auth-rejected") {
      out.add(url);
    }
  }
  return out;
}
