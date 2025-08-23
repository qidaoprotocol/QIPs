import React from 'react'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ConnectKitProvider } from 'connectkit'
import { mainnet } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { config, getChains, getDefaultChainId, localBaseFork } from '../config'
import { createQueryClient, setupPersistentCache } from '../config/queryClient'

// Get chains from config
const chains = getChains()

// Transports configuration
const transports = {
  [localBaseFork.id]: http(config.baseRpcUrl),
  [8453]: http(config.baseRpcUrl), // Base
  [84532]: http(), // Base Sepolia
  [mainnet.id]: http(),
}

// Wagmi configuration
const wagmiConfig = createConfig({
  chains: chains as any, // Cast to any to avoid tuple type issues
  transports,
  connectors: [
    injected(),
    walletConnect({ 
      projectId: config.walletConnectProjectId || 'dummy-project-id',
      showQrModal: true,
      qrModalOptions: {
        themeMode: 'light',
      },
    }),
  ],
})

// Create query client with optimized caching
const queryClient = createQueryClient()

// Setup persistent caching to localStorage
if (typeof window !== 'undefined') {
  setupPersistentCache(queryClient)
}

interface Web3ProviderProps {
  children: React.ReactNode
}

export const Web3Provider: React.FC<Web3ProviderProps> = ({ children }) => {
  // Log configuration in development
  React.useEffect(() => {
    if (config.isDevelopment) {
      console.log('🔧 Web3Provider Configuration:')
      console.log('- Environment:', process.env.NODE_ENV)
      console.log('- Chains:', chains.map(c => ({ id: c.id, name: c.name })))
      console.log('- WalletConnect Project ID:', config.walletConnectProjectId ? '✅ Set' : '❌ Not set')
      console.log('- Base RPC URL:', config.baseRpcUrl !== 'http://localhost:8545' ? '✅ Custom' : '❌ Using default')
    }
  }, [])

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="rounded"
          mode="light"
          debugMode={config.isDevelopment}
          options={{
            initialChainId: getDefaultChainId(),
            walletConnectName: "WalletConnect",
            disclaimer: (
              <div style={{ textAlign: 'center', padding: '10px' }}>
                <p>By connecting your wallet, you agree to the Terms of Service.</p>
              </div>
            ),
            hideBalance: false,
            hideTooltips: false,
            enforceSupportedChains: true,
          }}
        >
          {children}
        </ConnectKitProvider>
        {config.isDevelopment && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </WagmiProvider>
  )
}

// Export configuration for use in other parts of the app
export { wagmiConfig, queryClient, chains }