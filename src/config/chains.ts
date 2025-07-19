import { base, baseSepolia, mainnet } from 'wagmi/chains'
import { config } from './env'

/**
 * Local Base fork configuration for development
 */
export const localBaseFork = {
  ...base,
  id: 8453,
  name: 'Local Base Fork',
  network: 'local-base',
  rpcUrls: {
    default: { http: [config.baseRpcUrl] },
    public: { http: [config.baseRpcUrl] }
  }
}

/**
 * Get chains configuration based on environment
 */
export const getChains = () => {
  if (config.isDevelopment) {
    return [localBaseFork, base, baseSepolia, mainnet]
  }
  
  if (config.useTestnet) {
    return [baseSepolia, base, mainnet]
  }
  
  return [base, mainnet]
}

/**
 * Get default chain ID based on environment
 */
export const getDefaultChainId = () => {
  if (config.isDevelopment && config.localMode) {
    return localBaseFork.id
  }
  
  if (config.useTestnet) {
    return baseSepolia.id
  }
  
  return base.id
}