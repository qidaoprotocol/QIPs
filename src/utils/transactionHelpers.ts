import type { MultisigTransactionGroup } from './transactionParser';

/**
 * Chain explorer URL mappings
 */
export const CHAIN_EXPLORERS: Record<string, string> = {
  'Ethereum': 'https://etherscan.io/address/',
  'Polygon': 'https://polygonscan.com/address/',
  'Base': 'https://basescan.org/address/',
  'Arbitrum': 'https://arbiscan.io/address/',
  'Optimism': 'https://optimistic.etherscan.io/address/',
  'BSC': 'https://bscscan.com/address/',
  'Avalanche': 'https://snowtrace.io/address/',
  'Metis': 'https://andromeda-explorer.metis.io/address/'
};

/**
 * Get the block explorer URL for a given chain and address
 */
export function getChainExplorerUrl(chain: string, address: string): string | null {
  const explorerBase = CHAIN_EXPLORERS[chain];
  return explorerBase ? `${explorerBase}${address}` : null;
}

/**
 * Get the chain from a multisig group (uses first transaction's chain)
 */
export function getGroupChain(group: MultisigTransactionGroup): string {
  if (group.transactions.length === 0) return 'Ethereum';
  return group.transactions[0].chain;
}
