import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base } from "viem/chains";
import {
  __resetForTests,
  dehydrate,
  flushDehydrateForTests,
  getDeniedEndpointsForChain,
  getSnapshot,
  hydrate,
  observabilityHandle,
  recordAuthRejected,
  recordCorsBlocked,
  recordResponse,
} from "./rpcObservability";

const PERSIST_KEY = "qips:rpc-health:v1";

// Must be a URL present in RPC_POOLS[base.id] so the hash-validated
// hydration path can recognise it.
const BASE_URL = "https://base-rpc.publicnode.com";

const registerBase = (urls: readonly string[] = [BASE_URL]) =>
  observabilityHandle.register(base.id, {
    endpoints: urls,
    probeEndpoint: vi.fn(async () => undefined),
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  __resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rpcObservability persistence", () => {
  describe("dehydrate / hydrate round-trip", () => {
    it("persists a terminal cors-blocked entry and restores it on the next session", () => {
      registerBase();
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      flushDehydrateForTests();

      // Reset only in-memory state — leave localStorage intact.
      __resetForTests({ keepStorage: true });
      registerBase();
      hydrate();

      const restored = getSnapshot()[base.id]?.[BASE_URL];
      expect(restored?.state).toBe("cors-blocked");
      expect(restored?.demotedAt).toBeDefined();
    });
  });

  describe("TTL gating", () => {
    it("does NOT restore a cors-blocked entry older than 1h (terminal TTL)", () => {
      registerBase();
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      flushDehydrateForTests();

      __resetForTests({ keepStorage: true });
      vi.setSystemTime(Date.now() + 90 * 60 * 1000); // 90 min later
      registerBase();
      hydrate();

      // `register()` pre-seeds the URL as state="unknown" to prevent the
      // RpcStatusBanner false-positive on cold load. The TTL-gated hydrate
      // is verified by the state staying at "unknown" rather than being
      // restored to "cors-blocked", AND by the denied set being empty.
      const restored = getSnapshot()[base.id]?.[BASE_URL];
      expect(restored?.state).toBe("unknown");
      expect(getDeniedEndpointsForChain(base.id).size).toBe(0);
    });

    it("DOES restore a healthy entry within 24h (positive TTL)", () => {
      registerBase();
      recordResponse(base.id, BASE_URL, { ok: true, status: 200 });
      flushDehydrateForTests();

      __resetForTests({ keepStorage: true });
      vi.setSystemTime(Date.now() + 12 * 60 * 60 * 1000); // 12h later
      registerBase();
      hydrate();

      const restored = getSnapshot()[base.id]?.[BASE_URL];
      expect(restored?.state).toBe("healthy");
    });

    it("drops the whole blob when its overall ts exceeds 24h", () => {
      registerBase();
      recordResponse(base.id, BASE_URL, { ok: true, status: 200 });
      flushDehydrateForTests();

      __resetForTests({ keepStorage: true });
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000); // 25h later
      registerBase();
      hydrate();

      // Pre-seeded by register() as "unknown" but NOT restored to "healthy"
      // from the expired persisted blob.
      expect(getSnapshot()[base.id]?.[BASE_URL]?.state).toBe("unknown");
    });
  });

  describe("pool-hash invalidation", () => {
    it("drops the persisted blob when the current pool composition no longer matches", () => {
      registerBase();
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      flushDehydrateForTests();

      // Tamper the persisted blob's poolHash to simulate a future deploy
      // that edited RPC_POOLS — the hash will no longer match.
      const raw = window.localStorage.getItem(PERSIST_KEY);
      expect(raw).not.toBeNull();
      const blob = JSON.parse(raw!);
      blob.poolHash = "stale-hash-from-a-previous-deploy";
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(blob));

      __resetForTests({ keepStorage: true });
      registerBase();
      hydrate();

      // Pre-seeded as "unknown" by register() but NOT restored to the
      // persisted "cors-blocked" because the pool hash didn't match.
      expect(getSnapshot()[base.id]?.[BASE_URL]?.state).toBe("unknown");
      expect(window.localStorage.getItem(PERSIST_KEY)).toBeNull();
    });
  });

  describe("denied endpoint set", () => {
    it("includes cors-blocked URLs", () => {
      registerBase();
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      const denied = getDeniedEndpointsForChain(base.id);
      expect(denied.has(BASE_URL)).toBe(true);
    });

    it("includes auth-rejected URLs", () => {
      registerBase();
      recordAuthRejected(base.id, BASE_URL, { status: 403 });
      const denied = getDeniedEndpointsForChain(base.id);
      expect(denied.has(BASE_URL)).toBe(true);
    });

    it("excludes cooling URLs (cooling is recoverable, not terminal)", () => {
      registerBase();
      recordResponse(base.id, BASE_URL, { ok: false, status: 500 });
      const denied = getDeniedEndpointsForChain(base.id);
      expect(denied.has(BASE_URL)).toBe(false);
    });
  });

  describe("hydration drops stale URLs no longer in the pool", () => {
    it("does not restore an entry whose URL is absent from RPC_POOLS for that chain", () => {
      // Persist a blob whose entries include a URL that is NOT in the
      // current RPC_POOLS[base.id]. We do this by tampering the blob directly
      // (recordCorsBlocked against a URL outside the pool would still write
      // to in-memory state, but the realistic case is a deploy that REMOVED
      // a URL from defaults while a previous session's persisted entry still
      // references it).
      registerBase();
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      flushDehydrateForTests();

      const blob = JSON.parse(window.localStorage.getItem(PERSIST_KEY)!);
      // Inject an entry for a URL that's NOT in RPC_POOLS[base.id].
      blob.entries[base.id]["https://removed-from-defaults.example.com"] = {
        state: "cors-blocked",
        demotedAt: Date.now(),
        hadOkSample: false,
      };
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(blob));

      __resetForTests({ keepStorage: true });
      registerBase();
      hydrate();

      expect(getSnapshot()[base.id]?.[BASE_URL]?.state).toBe("cors-blocked");
      expect(
        getSnapshot()[base.id]?.["https://removed-from-defaults.example.com"],
      ).toBeUndefined();
    });
  });

  describe("write throttling", () => {
    it("collapses many state changes into a single localStorage write", () => {
      registerBase();
      // Spy on the actual `setItem` on the polyfilled localStorage instance;
      // `Storage.prototype` does not intercept our MemoryStorage polyfill.
      const setItemSpy = vi.spyOn(window.localStorage, "setItem");

      for (let i = 0; i < 50; i += 1) {
        recordResponse(base.id, BASE_URL, { ok: i % 2 === 0, status: 200 });
      }

      // Within the throttle window, no writes happen.
      expect(setItemSpy).not.toHaveBeenCalled();

      // After the throttle window, exactly one write lands.
      vi.advanceTimersByTime(1500);
      expect(setItemSpy.mock.calls.filter(([k]) => k === PERSIST_KEY)).toHaveLength(
        1,
      );

      setItemSpy.mockRestore();
    });
  });

  describe("error resilience", () => {
    it("swallows window.localStorage.setItem failures without throwing", () => {
      registerBase();
      const setItemSpy = vi
        .spyOn(window.localStorage, "setItem")
        .mockImplementation(() => {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        });

      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      expect(() => flushDehydrateForTests()).not.toThrow();
      expect(() => dehydrate()).not.toThrow();

      setItemSpy.mockRestore();
    });
  });

  describe("F10 timer restoration with elapsed demotedAt", () => {
    it("schedules the recovery probe at (delay - elapsed) when persisted entry is mid-window", async () => {
      const probe = vi.fn(async () => undefined);
      observabilityHandle.register(base.id, {
        endpoints: [BASE_URL],
        probeEndpoint: probe,
      });
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      flushDehydrateForTests();

      __resetForTests({ keepStorage: true });

      // 30 min later — half of the 1h first-slot window has already elapsed.
      vi.setSystemTime(Date.now() + 30 * 60 * 1000);

      observabilityHandle.register(base.id, {
        endpoints: [BASE_URL],
        probeEndpoint: probe,
      });
      hydrate();

      // After 29 more minutes the probe should NOT have fired yet.
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
      expect(probe).not.toHaveBeenCalled();

      // After 2 more minutes (cumulative 31 from hydrate), it should have.
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(probe).toHaveBeenCalledTimes(1);
    });

    it("schedules the recovery probe immediately when persisted entry is past the final slot", async () => {
      const probe = vi.fn(async () => undefined);
      observabilityHandle.register(base.id, {
        endpoints: [BASE_URL],
        probeEndpoint: probe,
      });
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      // Override the 1h-from-now TTL gate by using a fresh blob whose ts and
      // demotedAt span the full F10 cumulative window. The cumulative is
      // 1h + 6h + 24h = 31h; we need elapsed > 31h to land in the
      // "fire immediately" branch.
      flushDehydrateForTests();

      __resetForTests({ keepStorage: true });

      // 40h later — past 1h+6h+24h = 31h cumulative.
      // Per-entry terminal TTL is 1h, so we need to bypass the hydrate TTL
      // check by tampering ts on the persisted blob to keep the entry alive.
      const blob = JSON.parse(window.localStorage.getItem(PERSIST_KEY)!);
      // Pretend the blob was written 40h after the demotedAt (so age == 0
      // at hydrate time, passing the TTL gate), but demotedAt is 40h in the
      // past.
      const nowAfter = Date.now() + 40 * 60 * 60 * 1000;
      blob.ts = nowAfter;
      blob.entries[base.id][BASE_URL].demotedAt = nowAfter - 40 * 60 * 60 * 1000;
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(blob));

      vi.setSystemTime(nowAfter);

      observabilityHandle.register(base.id, {
        endpoints: [BASE_URL],
        probeEndpoint: probe,
      });
      hydrate();

      // Fires within the next event loop tick (delay=0 setTimeout).
      await vi.advanceTimersByTimeAsync(1);
      expect(probe).toHaveBeenCalledTimes(1);
    });
  });

  describe("hadOkSample round-trip", () => {
    it("preserves hadOkSample across hydration", () => {
      registerBase();
      // Make endpoint healthy, then promote to auth-rejected.
      recordResponse(base.id, BASE_URL, { ok: true, status: 200 });
      recordAuthRejected(base.id, BASE_URL, { status: 403 });
      flushDehydrateForTests();

      __resetForTests({ keepStorage: true });
      registerBase();
      hydrate();

      const restored = getSnapshot()[base.id]?.[BASE_URL];
      expect(restored?.state).toBe("auth-rejected");
      expect(restored?.hadOkSample).toBe(true);
    });
  });

  describe("RpcStatusBanner false-positive guard", () => {
    it("registration pre-seeds unknown entries for ALL registered endpoints (prevents banner flash on cold load with persisted health)", () => {
      // Reproduce the cold-load scenario: hydrate seeds ONE URL as cors-blocked,
      // then buildChainTransport calls observabilityHandle.register with the
      // full pool. Banner's deriveExhaustedFromSnapshot would false-positive
      // if the snapshot only contained the hydrated terminal entry.
      const BAD_URL = BASE_URL;
      const GOOD_URLS = ["https://base.drpc.org", "https://base-mainnet.public.blastapi.io"];

      // Step 1: hydrate seeds the bad URL via the real persistence path.
      observabilityHandle.register(base.id, {
        endpoints: [BAD_URL],
        probeEndpoint: vi.fn(async () => undefined),
      });
      recordCorsBlocked(base.id, BAD_URL, new TypeError("Failed to fetch"));
      flushDehydrateForTests();
      __resetForTests({ keepStorage: true });
      hydrate();

      // After hydrate: only the bad URL is in the snapshot.
      const afterHydrate = getSnapshot()[base.id];
      expect(Object.keys(afterHydrate ?? {})).toEqual([BAD_URL]);

      // Step 2: buildChainTransport calls register with the FULL pool.
      observabilityHandle.register(base.id, {
        endpoints: [BAD_URL, ...GOOD_URLS],
        probeEndpoint: vi.fn(async () => undefined),
      });

      // After register: the snapshot reflects the full pool, with the good
      // URLs as state="unknown" — banner's deriveExhaustedFromSnapshot will
      // skip them and NOT report the chain as exhausted.
      const afterRegister = getSnapshot()[base.id] ?? {};
      expect(afterRegister[BAD_URL]?.state).toBe("cors-blocked");
      for (const url of GOOD_URLS) {
        expect(afterRegister[url]?.state).toBe("unknown");
      }

      // Simulate the banner's logic: are there only non-healthy-non-unknown
      // states? It should be FALSE because the good URLs are unknown.
      const urls = Object.keys(afterRegister);
      const allDown = urls.every((url) => {
        const s = afterRegister[url].state;
        return s !== "healthy" && s !== "unknown";
      });
      expect(allDown).toBe(false);
    });
  });

  describe("__resetForTests", () => {
    it("clears localStorage by default", () => {
      registerBase();
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      flushDehydrateForTests();
      expect(window.localStorage.getItem(PERSIST_KEY)).not.toBeNull();

      __resetForTests();
      expect(window.localStorage.getItem(PERSIST_KEY)).toBeNull();
    });

    it("keeps localStorage when keepStorage: true", () => {
      registerBase();
      recordCorsBlocked(base.id, BASE_URL, new TypeError("Failed to fetch"));
      flushDehydrateForTests();
      expect(window.localStorage.getItem(PERSIST_KEY)).not.toBeNull();

      __resetForTests({ keepStorage: true });
      expect(window.localStorage.getItem(PERSIST_KEY)).not.toBeNull();
    });
  });
});
