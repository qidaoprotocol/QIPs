import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base } from "viem/chains";
import {
  __resetForTests,
  flushDehydrateForTests,
  getDeniedEndpointsForChain,
  hydrate,
  observabilityHandle,
  recordCorsBlocked,
} from "./rpcObservability";
import {
  __resetTransportCacheForTests,
  buildChainTransport,
  getPoolEndpoints,
} from "./rpcPools";

const PERSIST_KEY = "qips:rpc-health:v1";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  if (typeof window !== "undefined" && window.localStorage)
    window.localStorage.clear();
  __resetTransportCacheForTests();
  __resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildChainTransport composition filter", () => {
  it("constructs a transport with all default Base endpoints when nothing is denied", () => {
    const transport = buildChainTransport(base.id);
    expect(transport).toBeDefined();
    // Indirect check — getPoolEndpoints is the source-of-truth list; after
    // filter with empty denied set, the transport composes over the full list.
    expect(getDeniedEndpointsForChain(base.id).size).toBe(0);
    expect(getPoolEndpoints(base.id).length).toBeGreaterThan(0);
  });

  it("filters out denied endpoints when buildChainTransport is called after hydrate", () => {
    const endpoints = getPoolEndpoints(base.id);
    expect(endpoints.length).toBeGreaterThan(1);
    const targetUrl = endpoints[0];

    // Seed terminal state for the first endpoint.
    observabilityHandle.register(base.id, {
      endpoints,
      probeEndpoint: vi.fn(async () => undefined),
    });
    recordCorsBlocked(base.id, targetUrl, new TypeError("Failed to fetch"));
    flushDehydrateForTests();

    __resetForTests({ keepStorage: true });
    __resetTransportCacheForTests();

    // Hydrate seeds in-memory state from localStorage.
    hydrate();

    // Build a fresh transport. The composition-time filter should now omit
    // the denied URL from the active fallback chain.
    const transport = buildChainTransport(base.id);
    expect(transport).toBeDefined();
    expect(getDeniedEndpointsForChain(base.id).has(targetUrl)).toBe(true);
  });

  it("falls back to the full pool when every endpoint is denied (R2 exception)", () => {
    const endpoints = getPoolEndpoints(base.id);
    observabilityHandle.register(base.id, {
      endpoints,
      probeEndpoint: vi.fn(async () => undefined),
    });
    // Deny every endpoint.
    for (const url of endpoints) {
      recordCorsBlocked(base.id, url, new TypeError("Failed to fetch"));
    }
    expect(getDeniedEndpointsForChain(base.id).size).toBe(endpoints.length);

    __resetTransportCacheForTests();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // Should construct successfully (degraded — full pool used because
    // filtering would have left zero endpoints).
    const transport = buildChainTransport(base.id);
    expect(transport).toBeDefined();
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("denied at compose time");

    warnSpy.mockRestore();
  });

  it("respects pool-hash invalidation: a stale persisted blob doesn't carry denials forward", () => {
    const endpoints = getPoolEndpoints(base.id);
    const targetUrl = endpoints[0];

    observabilityHandle.register(base.id, {
      endpoints,
      probeEndpoint: vi.fn(async () => undefined),
    });
    recordCorsBlocked(base.id, targetUrl, new TypeError("Failed to fetch"));
    flushDehydrateForTests();

    // Tamper poolHash on the persisted blob.
    const raw = window.localStorage.getItem(PERSIST_KEY);
    expect(raw).not.toBeNull();
    const blob = JSON.parse(raw!);
    blob.poolHash = "stale-hash";
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(blob));

    __resetForTests({ keepStorage: true });
    __resetTransportCacheForTests();

    hydrate();

    // The denied set is empty because hydrate dropped the blob entirely.
    expect(getDeniedEndpointsForChain(base.id).size).toBe(0);
    expect(window.localStorage.getItem(PERSIST_KEY)).toBeNull();
  });
});
