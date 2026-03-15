import type { MultisigTransactionGroup } from './transactionParser';
import { getExplorerAddressUrl } from '../config/proposalChains';

/**
 * Get the block explorer URL for a given chain and address
 */
export function getChainExplorerUrl(chain: string, address: string): string | null {
  return getExplorerAddressUrl(chain, address);
}

/**
 * Get the chain from a multisig group (uses first transaction's chain)
 */
export function getGroupChain(group: MultisigTransactionGroup): string {
  if (group.transactions.length === 0) return 'Ethereum';
  return group.transactions[0].chain;
}
