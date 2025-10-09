import type { TransactionData } from './abiParser';
import { ABIParser } from './abiParser';

export interface MultisigTransactionGroup {
  multisig?: string;
  transactions: TransactionData[];
}

/**
 * Extract transactions from markdown content for UI rendering
 * This is used to display transactions separately from the main content
 *
 * Supports both formats:
 * - New format: Array of { multisig, transactions } objects
 * - Legacy format: Array of transaction objects
 */
export function extractTransactionsFromMarkdown(content: string): {
  contentWithoutTransactions: string;
  transactions: TransactionData[];
  transactionGroups: MultisigTransactionGroup[];
} {
  // Match the ## Transactions section with JSON code block
  const transactionsMatch = content.match(/##\s*Transactions\s*\n+```json\s*\n([\s\S]+?)\n```/);

  if (!transactionsMatch) {
    return {
      contentWithoutTransactions: content,
      transactions: [],
      transactionGroups: [],
    };
  }

  try {
    // Parse the JSON
    let transactionsJson = JSON.parse(transactionsMatch[1]);

    if (!Array.isArray(transactionsJson)) {
      console.warn('[transactionParser] Transactions JSON is not an array:', typeof transactionsJson);
      return {
        contentWithoutTransactions: content,
        transactions: [],
        transactionGroups: [],
      };
    }

    console.log('[TX_DEBUG] transactionParser: Parsed JSON from markdown, length:', transactionsJson.length);
    console.log('[TX_DEBUG] transactionParser: First element type:', typeof transactionsJson[0]);

    // Handle double-nested array bug from older versions
    // If the first element is itself an array, unwrap it
    if (transactionsJson.length === 1 && Array.isArray(transactionsJson[0])) {
      console.log('[TX_DEBUG] transactionParser: Detected double-nested array, unwrapping...');
      transactionsJson = transactionsJson[0];
      console.log('[TX_DEBUG] transactionParser: After unwrap, length:', transactionsJson.length);
    }

    // Detect format: check if first element has 'multisig' and 'transactions' fields
    const isNewFormat = transactionsJson.length > 0 &&
                        'multisig' in transactionsJson[0] &&
                        'transactions' in transactionsJson[0];

    console.log('[TX_DEBUG] transactionParser: Format detected:', isNewFormat ? 'NEW (multisig-grouped)' : 'LEGACY (flat)');

    let transactionGroups: MultisigTransactionGroup[];

    if (isNewFormat) {
      // New format: array of { multisig, transactions } objects
      console.log('[TX_DEBUG] transactionParser: Processing new format, groups:', transactionsJson.length);
      transactionGroups = transactionsJson.map((group: any, groupIdx: number) => {
        console.log(`[TX_DEBUG] transactionParser: Group ${groupIdx} - multisig:`, group.multisig, 'transactions:', group.transactions?.length);
        return {
          multisig: group.multisig,
          transactions: group.transactions.map((tx: any) =>
            ABIParser.parseTransaction(JSON.stringify(tx))
          ),
        };
      });
    } else {
      // Legacy format: array of transactions (no multisig grouping)
      console.log('[TX_DEBUG] transactionParser: Processing legacy format, transactions:', transactionsJson.length);
      const transactions = transactionsJson.map((tx: any) =>
        ABIParser.parseTransaction(JSON.stringify(tx))
      );

      // Convert to single group with undefined multisig
      transactionGroups = [{
        multisig: undefined,
        transactions,
      }];
    }

    // Flatten all transactions for backward compatibility
    const allTransactions = transactionGroups.flatMap(group => group.transactions);

    console.log('[TX_DEBUG] transactionParser: Successfully parsed transactions');
    console.log('[TX_DEBUG] transactionParser: Groups:', transactionGroups.length, 'Total transactions:', allTransactions.length);

    // Remove the transactions section from content for rendering
    const contentWithoutTransactions = content
      .replace(/##\s*Transactions\s*\n+```json\s*\n[\s\S]+?\n```\s*/, '')
      .trim();

    return {
      contentWithoutTransactions,
      transactions: allTransactions,
      transactionGroups,
    };
  } catch (error) {
    console.error('[transactionParser] Failed to parse transactions from markdown:', error);
    console.error('[transactionParser] Transaction JSON that failed:', transactionsMatch?.[1]);
    return {
      contentWithoutTransactions: content,
      transactions: [],
      transactionGroups: [],
    };
  }
}

/**
 * Parse transactions from QCI content for ProposalEditor
 * This extracts and parses transactions so they can be edited
 */
export function parseTransactionsFromContent(content: string): TransactionData[] {
  const { transactions } = extractTransactionsFromMarkdown(content);
  return transactions;
}

/**
 * Group transactions by multisig address for storage/display
 * This is used when creating or updating QCIs
 */
export function groupTransactionsByMultisig(transactions: TransactionData[]): MultisigTransactionGroup[] {
  if (transactions.length === 0) {
    return [];
  }

  // Group transactions by multisig address
  const grouped = transactions.reduce((groups, tx) => {
    const multisig = tx.multisig || 'undefined';
    if (!groups[multisig]) {
      groups[multisig] = [];
    }
    groups[multisig].push(tx);
    return groups;
  }, {} as Record<string, TransactionData[]>);

  // Convert to array format
  return Object.entries(grouped).map(([multisig, txs]) => ({
    multisig: multisig === 'undefined' ? undefined : multisig,
    transactions: txs,
  }));
}
