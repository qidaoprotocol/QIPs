import React from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ConnectKitProvider } from "connectkit";
import { arbitrum, base, baseSepolia, gnosis, mainnet, optimism, polygon } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { config, getChains, getDefaultChainId, localBaseFork } from "../config";
import { createQueryClient, setupPersistentCache, clearQCICacheOnFreshLoad, CACHE_TIMES } from "../config/queryClient";
import { useTheme } from "../providers/ThemeProvider";
import { queryKeys } from "../utils/queryKeys";
import { QCIClient } from "../services/qciClient";
import { ALL_STATUS_NAMES, ALL_STATUS_HASHES } from "../config/statusConfig";
import { buildChainTransport } from "../utils/rpcPools";
import { attachDebugGlobal } from "../utils/rpcObservability";
import { RpcStatusBanner } from "../components/RpcStatusBanner";

// Get chains from config
const chains = getChains();

// Transports — every chain (except the localBaseFork dev shim) flows through
// buildChainTransport, which returns a memoized viem.fallback per chainId
// with rank-based health probing, Retry-After honoring via per-http retry,
// and observability hooks. Chains here MUST stay in sync with
// src/config/chains.ts; missing entries silently break wagmi reads on that
// chain. The localBaseFork shim shares base.id, so passing
// { rpcUrlOverride: config.baseRpcUrl } gives the local Anvil flow a single-
// endpoint transport without the pool/observability overhead.
const transports = {
  [localBaseFork.id]: http(config.baseRpcUrl),
  [base.id]: buildChainTransport(base.id),
  [baseSepolia.id]: buildChainTransport(baseSepolia.id),
  [mainnet.id]: buildChainTransport(mainnet.id),
  [optimism.id]: buildChainTransport(optimism.id),
  [gnosis.id]: buildChainTransport(gnosis.id),
  [polygon.id]: buildChainTransport(polygon.id),
  [arbitrum.id]: buildChainTransport(arbitrum.id),
};

// Attach window.__qipsRpc in dev so console-level debugging works.
attachDebugGlobal();

// Wagmi configuration
const wagmiConfig = createConfig({
  chains: chains as any, // Cast to any to avoid tuple type issues
  transports,
  connectors: [
    injected(),
    walletConnect({
      projectId: config.walletConnectProjectId || "dummy-project-id",
      showQrModal: false,
    }),
  ],
});

const queryClient = createQueryClient();

if (typeof window !== "undefined") {
  clearQCICacheOnFreshLoad();
  setupPersistentCache(queryClient);
}

interface Web3ProviderProps {
  children: React.ReactNode;
}

export const Web3Provider: React.FC<Web3ProviderProps> = ({ children }) => {
  // Get theme from context
  const { theme } = useTheme();

  // Log configuration in development
  React.useEffect(() => {
    if (config.isDevelopment) {
      console.log("🔧 Web3Provider Configuration:");
      console.log("- Environment:", process.env.NODE_ENV);
      console.log(
        "- Chains:",
        chains.map((c) => ({ id: c.id, name: c.name }))
      );
      console.log("- WalletConnect Project ID:", config.walletConnectProjectId ? "✅ Set" : "❌ Not set");
      console.log("- Base RPC URL:", config.baseRpcUrl !== "http://localhost:8545" ? "✅ Custom" : "❌ Using default");
    }
  }, []);

  // Preload statuses on app initialization
  React.useEffect(() => {
    const preloadStatuses = async () => {
      if (!config.qciRegistryAddress) {
        console.log('[Web3Provider] No registry address available, skipping status preload');
        return;
      }

      try {
        console.log('[Web3Provider] 🚀 Preloading statuses...');

        // Check if statuses are already in cache and fresh
        const existingData = queryClient.getQueryData(queryKeys.allStatuses(config.qciRegistryAddress));
        const queryState = queryClient.getQueryState(queryKeys.allStatuses(config.qciRegistryAddress));

        // Only prefetch if:
        // 1. No data exists, OR
        // 2. Data is stale (older than 15 minutes)
        const shouldPrefetch = !existingData ||
          !queryState ||
          (queryState.dataUpdatedAt && Date.now() - queryState.dataUpdatedAt > 15 * 60 * 1000);

        if (!shouldPrefetch) {
          console.log('[Web3Provider] ✓ Statuses already cached and fresh, skipping prefetch');
          return;
        }

        // Use prefetchQuery to load data into cache without triggering component re-renders
        await queryClient.prefetchQuery({
          queryKey: queryKeys.allStatuses(config.qciRegistryAddress),
          queryFn: async () => {
            try {
              const qciClient = new QCIClient(config.qciRegistryAddress!, config.baseRpcUrl, false);
              const result = await qciClient.fetchAllStatuses();

              const statusArray = result.names.map((name, index) => ({
                name,
                hash: result.hashes[index],
              }));

              console.log(`[Web3Provider] ✓ Preloaded ${statusArray.length} statuses`);
              return statusArray;
            } catch (error) {
              console.error('[Web3Provider] Status preload failed, using fallback:', error);
              // Fallback to static config
              return ALL_STATUS_NAMES.map((name, index) => ({
                name,
                hash: ALL_STATUS_HASHES[index],
              }));
            }
          },
          staleTime: 15 * 60 * 1000, // 15 minutes
          gcTime: 60 * 60 * 1000, // 1 hour garbage collection
        });
      } catch (error) {
        console.error('[Web3Provider] Failed to preload statuses:', error);
      }
    };

    // Delay preloading slightly to avoid blocking initial render
    const timeoutId = setTimeout(preloadStatuses, 100);
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme={theme === "dark" ? "midnight" : "soft"}
          mode={theme}
          debugMode={config.isDevelopment}
          options={{
            initialChainId: getDefaultChainId(),
            walletConnectName: "WalletConnect",
            disclaimer: (
              <div style={{ textAlign: "center", padding: "10px" }}>
                <p>By connecting your wallet, you agree to the Terms of Service.</p>
              </div>
            ),
            hideBalance: false,
            hideTooltips: false,
            enforceSupportedChains: true,
          }}
        >
          {children}
          <RpcStatusBanner />
        </ConnectKitProvider>
        {config.isDevelopment && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </WagmiProvider>
  );
};

// Export configuration for use in other parts of the app
export { wagmiConfig, queryClient, chains };
