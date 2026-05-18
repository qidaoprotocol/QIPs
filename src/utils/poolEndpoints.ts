import {
  arbitrum,
  base,
  baseSepolia,
  gnosis,
  mainnet,
  optimism,
  polygon,
} from "viem/chains";

/**
 * Per-chain RPC endpoint defaults, ordered most-trusted-first.
 *
 * Curated from chainlist (DefiLlama/chainlist's `extraRpcs.js`) with these filters:
 *   - https only (no wss for now — websocket transport is deferred)
 *   - no embedded API keys (`/<32-hex-chars>` patterns, `?api_key=`, etc.)
 *   - no `tracking: "yes"` providers (Tenderly, Tatum, Lava, Numa, BloxRoute) —
 *     they harvest operator data
 *   - no Alchemy/Infura `/v2/demo` URLs (rate-limit immediately)
 *   - drop URLs we've observed failing browser CORS preflight from
 *     `qips.qidao.localhost` (e.g., 1rpc.io/op and 1rpc.io/arb)
 *   - **must pass browser-origin probe from `gov.mai.finance` AND
 *     `qips.qidao.localhost`** — curl-passing endpoints often fail browser
 *     CORS preflight; see `docs/solutions/runtime-errors/polygon-psm-rpc-401-
 *     and-decimals-regression-2026-04-22.md`
 *
 * With viem's `fallback` rank scheduler DISABLED (per plan 2026-05-18-001),
 * the input order here is the runtime order — no scoring or reranking takes
 * place. Composition is deterministic: the first available endpoint serves;
 * on failure, viem advances to the next in this list. Order each chain by
 * the most reliable / lowest-latency endpoint first, with first-party
 * endpoints relegated to last-resort positions where they are documented as
 * rate-limited for production.
 *
 * Polygon defaults explicitly EXCLUDE polygon-rpc.com per the
 * polygon-psm-rpc-401-2026-04-22 learning.
 *
 * Excluded from Base defaults (must not be re-added without a fresh
 * browser-origin probe):
 *   - https://base.llamarpc.com  — CORS preflight stalls ~10s before aborting
 *     from browser origins; consistently observed in chrome-devtools profiling
 *   - https://base.api.onfinality.io/public  — 429 immediately under multicall
 *     load (3,000 RU/min public-tier cap); see
 *     `docs/solutions/integration-issues/qciclient-rpc-override-bypassed-pool-2026-05-08.md`
 *
 * To refresh from chainlist: `curl -s
 * https://raw.githubusercontent.com/DefiLlama/chainlist/main/constants/extraRpcs.js`
 * and apply the filters above.
 */
export const RPC_POOLS: Record<number, readonly string[]> = {
  [base.id]: [
    // Canonical Base order per plan 2026-05-18-001. publicnode + drpc are
    // production-consensus reliable (Uniswap, gnars, Reown all place one of
    // these first). `mainnet.base.org` is last because Base's own docs say
    // it is "rate-limited, not designed for production workloads"
    // (https://docs.base.org/base-chain/quickstart/connecting-to-base).
    "https://base-rpc.publicnode.com",
    "https://base.drpc.org",
    "https://base-mainnet.public.blastapi.io",
    "https://1rpc.io/base",
    "https://base.meowrpc.com",
    "https://base-public.nodies.app",
    "https://mainnet.base.org",
  ],
  [baseSepolia.id]: [
    "https://sepolia.base.org",
    "https://base-sepolia-rpc.publicnode.com",
    "https://base-sepolia.drpc.org",
  ],
  [mainnet.id]: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.drpc.org",
    "https://eth-mainnet.public.blastapi.io",
    "https://1rpc.io/eth",
    "https://ethereum.public.blockpi.network/v1/rpc/public",
    "https://eth.meowrpc.com",
    "https://ethereum-public.nodies.app",
  ],
  [polygon.id]: [
    "https://polygon.drpc.org",
    "https://polygon-bor-rpc.publicnode.com",
    "https://1rpc.io/matic",
    "https://polygon-public.nodies.app",
  ],
  [optimism.id]: [
    "https://mainnet.optimism.io",
    "https://optimism-rpc.publicnode.com",
    "https://optimism.drpc.org",
    "https://optimism.public.blockpi.network/v1/rpc/public",
    "https://optimism-public.nodies.app",
  ],
  [arbitrum.id]: [
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arbitrum.drpc.org",
    "https://arbitrum-one.public.blastapi.io",
    "https://arbitrum.public.blockpi.network/v1/rpc/public",
    "https://arbitrum-one-public.nodies.app",
    "https://arbitrum.meowrpc.com",
  ],
  [gnosis.id]: [
    "https://rpc.gnosischain.com",
    "https://gnosis-rpc.publicnode.com",
    "https://gnosis.drpc.org",
    "https://1rpc.io/gnosis",
    "https://gnosis-public.nodies.app",
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
