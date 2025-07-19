import { config } from './env'

/**
 * Contract addresses by chain ID
 */
export const CONTRACT_ADDRESSES = {
  // Base Mainnet
  8453: {
    qipRegistry: config.qipRegistryAddress || '0xf5D5CdccEe171F02293337b7F3eda4D45B85B233',
  },
  // Base Sepolia
  84532: {
    qipRegistry: config.qipRegistryAddress || '0x0000000000000000000000000000000000000000', // TODO: Deploy to testnet
  },
} as const

/**
 * Get contract address for current chain
 */
export const getContractAddress = (chainId: number, contract: 'qipRegistry'): `0x${string}` => {
  const addresses = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES]
  
  if (!addresses) {
    throw new Error(`No contract addresses configured for chain ${chainId}`)
  }
  
  const address = addresses[contract]
  
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Contract ${contract} not deployed on chain ${chainId}`)
  }
  
  return address as `0x${string}`
}

/**
 * Contract ABIs
 */
export { default as QIP_REGISTRY_ABI } from './abis/QIPRegistry.json'