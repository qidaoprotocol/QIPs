import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { createConfig, http } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// Pages
import HomePage from './pages/HomePage'
import AllProposals from './pages/AllProposals'
import CreateProposal from './pages/CreateProposal'
import QIPDetail from './pages/QIPDetail'
import TemplatesPage from './pages/TemplatesPage'

// Environment configuration
const isDevelopment = process.env.NODE_ENV === 'development'
const walletConnectProjectId = process.env.GATSBY_WALLETCONNECT_PROJECT_ID || 'dummy-project-id'

// Local Base fork configuration for development
const localBaseFork = {
  ...base,
  id: 8453,
  name: 'Local Base Fork',
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
    public: { http: ['http://localhost:8545'] }
  }
}

// Wagmi configuration
const wagmiConfig = createConfig({
  chains: isDevelopment ? [localBaseFork, base, baseSepolia] : [base, baseSepolia],
  transports: {
    [localBaseFork.id]: http('http://localhost:8545'),
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
  connectors: [
    injected(),
    walletConnect({ 
      projectId: walletConnectProjectId,
      showQrModal: true,
    }),
  ],
})

// Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      gcTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="rounded"
          mode="light"
          options={{
            initialChainId: isDevelopment ? localBaseFork.id : base.id,
            walletConnectName: "WalletConnect",
            disclaimer: (
              <div style={{ textAlign: 'center', padding: '10px' }}>
                <p>By connecting your wallet, you agree to the Terms of Service.</p>
              </div>
            ),
          }}
        >
          <Router>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/all-proposals" element={<AllProposals />} />
              <Route path="/qips/:qipNumber" element={<QIPDetail />} />
              <Route path="/create-proposal" element={<CreateProposal />} />
              <Route path="/templates" element={<TemplatesPage />} />
            </Routes>
          </Router>
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App