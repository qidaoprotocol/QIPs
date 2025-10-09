import React from 'react';
import { ABIParser, type TransactionData } from '../utils/abiParser';
import { groupTransactionsByMultisig, type MultisigTransactionGroup } from '../utils/transactionParser';
import { getChainExplorerUrl, getGroupChain } from '../utils/transactionHelpers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Edit2, Trash2, ExternalLink, Copy, CheckCircle } from 'lucide-react';

interface TransactionGroupProps {
  transactions: TransactionData[] | string[];
  mode: 'view' | 'edit';
  onEdit?: (index: number) => void;
  onDelete?: (index: number) => void;
  defaultOpen?: boolean;
  showCopyButtons?: boolean;
  className?: string;
  heading?: string;
}

export const TransactionGroup: React.FC<TransactionGroupProps> = ({
  transactions,
  mode,
  onEdit,
  onDelete,
  defaultOpen = mode === 'view',
  showCopyButtons = mode === 'view',
  className = '',
  heading = 'Transactions'
}) => {
  const [openGroups, setOpenGroups] = React.useState<Record<number, boolean>>({});
  const [openTxStrings, setOpenTxStrings] = React.useState<Record<string, boolean>>({});
  const [copiedIndex, setCopiedIndex] = React.useState<string | null>(null);
  const [copiedMultisig, setCopiedMultisig] = React.useState<string | null>(null);
  const [copiedContractAddress, setCopiedContractAddress] = React.useState<string | null>(null);

  // Parse and group transactions
  const transactionGroups = React.useMemo(() => {
    // If transactions is a string array, parse it first
    if (transactions.length > 0 && typeof transactions[0] === 'string') {
      try {
        let parsed = JSON.parse(transactions[0] as string);

        // Handle double-nested array bug from older versions
        if (Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0])) {
          parsed = parsed[0];
        }

        // Check if it's the new format (array of multisig groups)
        if (Array.isArray(parsed) && parsed.length > 0 && 'multisig' in parsed[0] && 'transactions' in parsed[0]) {
          return parsed.map((group: any) => ({
            multisig: group.multisig,
            transactions: group.transactions.map((tx: any) => ABIParser.parseTransaction(JSON.stringify(tx))),
          }));
        } else if (Array.isArray(parsed)) {
          const txs = parsed.map((tx: any) => ABIParser.parseTransaction(JSON.stringify(tx)));
          return groupTransactionsByMultisig(txs);
        }
      } catch (error) {
        console.error('[TransactionGroup] Failed to parse transaction groups:', error);
      }
      return [];
    } else {
      // Already parsed TransactionData[]
      return groupTransactionsByMultisig(transactions as TransactionData[]);
    }
  }, [transactions]);

  // Initialize group open/closed state
  React.useEffect(() => {
    const initialState: Record<number, boolean> = {};
    transactionGroups.forEach((_, index) => {
      initialState[index] = defaultOpen;
    });
    setOpenGroups(initialState);
  }, [transactionGroups, defaultOpen]);

  const toggleGroup = (groupIndex: number) => {
    setOpenGroups(prev => ({
      ...prev,
      [groupIndex]: !prev[groupIndex],
    }));
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleCopyMultisig = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedMultisig(address);
    setTimeout(() => setCopiedMultisig(null), 2000);
  };

  const handleCopyContractAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedContractAddress(address);
    setTimeout(() => setCopiedContractAddress(null), 2000);
  };

  const toggleTxString = (txId: string) => {
    setOpenTxStrings(prev => ({
      ...prev,
      [txId]: !prev[txId],
    }));
  };

  // Calculate global index from group and transaction index
  const getGlobalIndex = (groupIndex: number, txIndexInGroup: number): number => {
    let globalIndex = 0;
    for (let i = 0; i < groupIndex; i++) {
      globalIndex += transactionGroups[i].transactions.length;
    }
    return globalIndex + txIndexInGroup;
  };

  if (transactionGroups.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {mode === 'view' && <h3 className="text-lg font-semibold text-foreground mb-4">{heading}</h3>}

      {transactionGroups.map((group, groupIndex) => (
        <Collapsible
          key={groupIndex}
          open={openGroups[groupIndex] ?? defaultOpen}
          onOpenChange={() => toggleGroup(groupIndex)}
        >
          <div className="rounded-lg bg-muted/30 overflow-hidden">
            {/* Multisig Header */}
            {group.multisig ? (
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2">
                    {openGroups[groupIndex] ? (
                      <ChevronDown size={16} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={16} className="text-muted-foreground" />
                    )}
                    <Badge variant="outline" className="font-mono text-xs">
                      Multisig
                    </Badge>
                    <code className="text-sm font-mono">{group.multisig}</code>
                    {(() => {
                      const multisigExplorerUrl = getChainExplorerUrl(getGroupChain(group), group.multisig);
                      return multisigExplorerUrl ? (
                        <a
                          href={multisigExplorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View multisig on block explorer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {group.transactions.length} transaction{group.transactions.length !== 1 ? 's' : ''}
                    </span>
                    {showCopyButtons && (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyMultisig(group.multisig!);
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        title="Copy multisig address"
                      >
                        {copiedMultisig === group.multisig ? (
                          <>
                            <CheckCircle size={12} className="mr-1 text-green-500" />
                            <span className="text-green-500">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} className="mr-1" />
                            <span>Copy Address</span>
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CollapsibleTrigger>
            ) : (
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2">
                    {openGroups[groupIndex] ? (
                      <ChevronDown size={16} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={16} className="text-muted-foreground" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      {group.transactions.length} transaction{group.transactions.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </CollapsibleTrigger>
            )}

            {/* Transactions in this group */}
            <CollapsibleContent>
              <div className="border-t border-border/50">
                {group.transactions.map((tx: TransactionData, txIndex: number) => {
                  const globalIndex = getGlobalIndex(groupIndex, txIndex);
                  const txId = `${groupIndex}-${txIndex}`;
                  const txString = ABIParser.formatTransaction(tx);
                  const explorerUrl = getChainExplorerUrl(tx.chain, tx.contractAddress);

                  return (
                    <div
                      key={txIndex}
                      className="flex items-start justify-between p-3 border-b border-border/50 last:border-b-0"
                    >
                      <div className="flex-1 space-y-1">
                        {/* Chain badge and contract address */}
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {tx.chain}
                          </Badge>
                          {explorerUrl ? (
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="View contract on block explorer"
                              className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors border-b border-dashed border-muted-foreground/40 hover:border-foreground/40"
                            >
                              <span>{tx.contractAddress}</span>
                              <ExternalLink size={12} />
                            </a>
                          ) : (
                            <code className="text-xs font-mono text-muted-foreground border-b border-dashed border-muted-foreground/40">
                              {tx.contractAddress}
                            </code>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => handleCopyContractAddress(tx.contractAddress)}
                            title="Copy contract address"
                          >
                            {copiedContractAddress === tx.contractAddress ? (
                              <CheckCircle size={12} className="text-green-500" />
                            ) : (
                              <Copy size={12} className="text-muted-foreground hover:text-foreground" />
                            )}
                          </Button>
                        </div>

                        {/* Function call */}
                        <code className="text-sm font-mono block">
                          {tx.functionName}({tx.args.map((arg: any) =>
                            typeof arg === 'string' && arg.length > 20
                              ? arg.slice(0, 10) + '...' + arg.slice(-8)
                              : JSON.stringify(arg)
                          ).join(', ')})
                        </code>

                        {/* Annotation */}
                        {tx.annotation && (
                          <p className="text-xs text-muted-foreground italic">
                            {tx.annotation}
                          </p>
                        )}

                        {/* Full transaction string (view mode only) - Collapsible */}
                        {showCopyButtons && (
                          <Collapsible
                            open={openTxStrings[txId] ?? false}
                            onOpenChange={() => toggleTxString(txId)}
                          >
                            <div className="mt-2 pt-2 border-t border-border/30">
                              <div className="flex items-center justify-between mb-1">
                                <CollapsibleTrigger asChild>
                                  <div className="flex items-center gap-1 cursor-pointer hover:bg-muted/30 rounded p-1 -ml-1 flex-1">
                                    {openTxStrings[txId] ? (
                                      <ChevronDown size={12} className="text-muted-foreground" />
                                    ) : (
                                      <ChevronRight size={12} className="text-muted-foreground" />
                                    )}
                                    <span className="text-xs text-muted-foreground">Technical Details</span>
                                  </div>
                                </CollapsibleTrigger>
                                <div
                                  className={`transition-opacity duration-200 ${
                                    openTxStrings[txId] ? 'opacity-100' : 'opacity-0 pointer-events-none'
                                  }`}
                                >
                                  <Button
                                    onClick={() => handleCopy(txString, txId)}
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
                                    title="Copy raw transaction JSON"
                                  >
                                    {copiedIndex === txId ? (
                                      <>
                                        <CheckCircle size={12} className="mr-1 text-green-500" />
                                        <span className="text-green-500">Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy size={12} className="mr-1" />
                                        <span>Copy JSON</span>
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </div>
                              <CollapsibleContent>
                                <div className="rounded bg-muted/40 p-3 mt-1">
                                  <pre className="text-xs font-mono overflow-x-auto">
                                    <code>{JSON.stringify(JSON.parse(txString), null, 2)}</code>
                                  </pre>
                                </div>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        )}
                      </div>

                      {/* Action buttons (edit mode only) */}
                      {mode === 'edit' && onEdit && onDelete && (
                        <div className="flex gap-2 ml-4">
                          <Button
                            type="button"
                            onClick={() => onEdit(globalIndex)}
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                          >
                            <Edit2 size={16} className="text-muted-foreground" />
                          </Button>
                          <Button
                            type="button"
                            onClick={() => onDelete(globalIndex)}
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                          >
                            <Trash2 size={16} className="text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ))}
    </div>
  );
};
