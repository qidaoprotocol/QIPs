import "./src/styles/global.css";

// gatsby-browser.js
import React from "react";
import { WagmiProvider, createConfig } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mainnet, base } from "wagmi/chains";
import { http } from "wagmi";
import { ConnectKitProvider, getDefaultConfig } from "connectkit";

// Local Base fork configuration
const localBase = {
  ...base,
  id: 8453,
  name: "Local Base Fork",
  network: "local-base",
  rpcUrls: {
    default: {
      http: ["http://localhost:8545"],
    },
    public: {
      http: ["http://localhost:8545"],
    },
  },
};

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === "development";
const chains = isDevelopment ? [localBase, mainnet, base] : [mainnet, base];

// Debug logging
console.log("🔧 Wagmi Configuration Debug:");
console.log("- NODE_ENV:", process.env.NODE_ENV);
console.log("- isDevelopment:", isDevelopment);
console.log("- GATSBY_WALLETCONNECT_PROJECT_ID:", process.env.GATSBY_WALLETCONNECT_PROJECT_ID);
console.log("- chains:", chains.map(c => ({ id: c.id, name: c.name })));

// Check if WalletConnect project ID exists
if (!process.env.GATSBY_WALLETCONNECT_PROJECT_ID) {
  console.error("❌ GATSBY_WALLETCONNECT_PROJECT_ID is not set!");
  console.error("This will cause wallet connection issues.");
}

let config;
try {
  config = createConfig(
    getDefaultConfig({
      appName: "Qidao",
      enableFamily: false,
      walletConnectProjectId: process.env.GATSBY_WALLETCONNECT_PROJECT_ID || "dummy-project-id",
      chains: chains,
      transports: {
        [mainnet.id]: http(),
        [base.id]: http(),
        [localBase.id]: http("http://localhost:8545"),
      },
    })
  );
  console.log("✅ Wagmi config created successfully");
} catch (error) {
  console.error("❌ Failed to create Wagmi config:", error);
}

const queryClient = new QueryClient();

// Debug wrapper component
const DebugWrapper = ({ children }) => {
  React.useEffect(() => {
    console.log("🔍 WagmiProvider mounted with config:", config);
    console.log("🔍 Checking window.ethereum:", typeof window !== 'undefined' ? window.ethereum : 'Not available (SSR)');
  }, []);
  
  return <>{children}</>;
};

export const wrapRootElement = ({ element }) => {
  console.log("🚀 wrapRootElement called");
  console.log("- config exists:", !!config);
  
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider debugMode={true}>
          <DebugWrapper>
            {element}
          </DebugWrapper>
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
