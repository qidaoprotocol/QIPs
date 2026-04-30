import { arbitrum, base, baseSepolia, gnosis, mainnet, optimism, polygon } from 'wagmi/chains'
import { config } from './env'

/**
 * Supported chains mirror the matrix Snapshot accepts for `qidao.eth` voting,
 * so any wallet that can vote on a Snapshot proposal can sign in to the
 * QIPs comments feature with the same key — including Safes whose contract
 * code lives on a non-Base chain (Polygon, Optimism, Gnosis, Arbitrum, …).
 *
 * Source of truth: https://snapshot.box/#/s:qidao.eth — when Snapshot adds
 * or drops a chain for the qidao.eth space, mirror the change here.
 *
 * Note: this list governs which chains the wallet may be on at sign-in.
 * The QCI Registry contract still lives on Base; `getDefaultChainId()`
 * keeps Base as the initial chain so non-comments routes (registry reads,
 * status reads) keep working without an explicit network switch.
 */

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
 * Get chains configuration based on environment.
 *
 * Production includes the full Snapshot `qidao.eth` matrix so cross-chain
 * Safes can connect without ConnectKit's "Wrong network" guard rejecting
 * them. Testnet adds `baseSepolia` first so dev wallets default to it.
 */
export const getChains = () => {
  if (config.isDevelopment) {
    return [localBaseFork, base, baseSepolia, mainnet, optimism, gnosis, polygon, arbitrum]
  }

  if (config.useTestnet) {
    return [baseSepolia, base, mainnet, optimism, gnosis, polygon, arbitrum]
  }

  return [mainnet, optimism, gnosis, polygon, base, arbitrum]
}

/**
 * Get default chain ID based on environment.
 *
 * Stays Base because the rest of the app reads the QCI Registry (on Base);
 * the comments path does not require Base — the SIWE flow embeds whichever
 * chain the wallet is actually on, so a Polygon Safe signs on Polygon and
 * verification picks the right RPC server-side.
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
