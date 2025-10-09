import type { TransactionData } from './abiParser';
import { ABIParser } from './abiParser';

/**
 * Extract transactions from markdown content for UI rendering
 * This is used to display transactions separately from the main content
 */
export function extractTransactionsFromMarkdown(content: string): {
  contentWithoutTransactions: string;
  transactions: TransactionData[];
} {
  // Match the ## Transactions section with JSON code block
  const transactionsMatch = content.match(/##\s*Transactions\s*\n+```json\s*\n([\s\S]+?)\n```/);

  if (!transactionsMatch) {
    return {
      contentWithoutTransactions: content,
      transactions: [],
    };
  }

  try {
    // Parse the JSON array
    const transactionsJson = JSON.parse(transactionsMatch[1]);

    if (!Array.isArray(transactionsJson)) {
      console.warn('Transactions JSON is not an array');
      return {
        contentWithoutTransactions: content,
        transactions: [],
      };
    }

    // Convert JSON objects to TransactionData format
    const transactions: TransactionData[] = transactionsJson.map((tx) => {
      // Parse the transaction using ABIParser
      const txString = JSON.stringify(tx);
      const parsed = ABIParser.parseTransaction(txString);
      return parsed;
    });

    // Remove the transactions section from content for rendering
    const contentWithoutTransactions = content
      .replace(/##\s*Transactions\s*\n+```json\s*\n[\s\S]+?\n```\s*/, '')
      .trim();

    return {
      contentWithoutTransactions,
      transactions,
    };
  } catch (error) {
    console.error('Failed to parse transactions from markdown:', error);
    return {
      contentWithoutTransactions: content,
      transactions: [],
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
