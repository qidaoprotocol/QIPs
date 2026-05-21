import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from 'react-router-dom';
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi';
import { type Address } from 'viem';
import { toast } from 'sonner';
import { type QCIContent } from "../services/qciClient";
import { useCreateQCI } from '../hooks/useCreateQCI';
import { useUpdateQCI } from '../hooks/useUpdateQCI';
import { config } from '../config/env';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChainCombobox } from "./ChainCombobox";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TransactionFormatter } from "./TransactionFormatter";
import { TransactionGroup } from "./TransactionGroup";
import { type TransactionData, ABIParser } from "../utils/abiParser";
import { groupTransactionsByMultisig, serializeTransactionsForBody } from "../utils/transactionParser";
import { formatProposalBody } from "../utils/snapshotPayload";
import { Plus } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAllChainNames } from '@/config/proposalChains';

// Warning threshold for the advisory counter — render amber at 80% of the
// limit, destructive (red) above the limit. Matches CommentComposer's
// canonical pattern. Editor doesn't enforce; the hard gate lives in the
// submitter. Tooltip on the counter explains the advisory nature.
const EDITOR_BODY_WARNING_RATIO = 0.8;

interface ProposalEditorProps {
  registryAddress: Address;
  rpcUrl?: string;
  existingQCI?: {
    qciNumber: bigint;
    content: QCIContent;
  };
  initialTitle?: string;
  initialChain?: string;
  initialContent?: string;
  initialImplementor?: string;
}

export const ProposalEditor: React.FC<ProposalEditorProps> = ({
  registryAddress,
  rpcUrl,
  existingQCI,
  initialTitle,
  initialChain,
  initialContent,
  initialImplementor,
}) => {
  const { address, isConnected, chain, status } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();
  const navigate = useNavigate();
  const location = useLocation();

  // Track if we've already navigated to prevent multiple navigations
  const hasNavigatedRef = useRef(false);

  // Check if we need to switch chains
  const isWrongChain = chain && chain.id !== 8453;

  const handleSwitchChain = async () => {
    try {
      await switchChain({ chainId: 8453 });
    } catch (error) {
      console.error("Failed to switch chain:", error);
    }
  };

  const importedData = (location.state as any)?.importedData;

  // Strip transactions from content for textarea display
  const getContentWithoutTransactions = (fullContent: string) => {
    return fullContent.replace(/##\s*Transactions\s*\n+```json\s*\n[\s\S]+?\n```\s*/, '').trim();
  };

  const [title, setTitle] = useState(existingQCI?.content.title || importedData?.title || initialTitle || "");
  const [combooxSelectedChain, setComboboxSelectedChain] = useState(
    existingQCI?.content.chain || importedData?.chain || initialChain || "Polygon PoS"
  );
  const [content, setContent] = useState(
    existingQCI?.content.content
      ? getContentWithoutTransactions(existingQCI.content.content)
      : importedData?.content || initialContent || ""
  );
  const [implementor, setImplementor] = useState(
    existingQCI?.content.implementor || importedData?.implementor || initialImplementor || "None"
  );
  const [author] = useState(existingQCI?.content.author || address || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [editingTransactionIndex, setEditingTransactionIndex] = useState<number | null>(null);

  const queryClient = useQueryClient();

  // Initialize mutation hooks
  const createQCIMutation = useCreateQCI({ registryAddress });
  const updateQCIMutation = useUpdateQCI({ registryAddress });

  // Advisory projection of the Snapshot body the user is composing. Routes
  // through the same shared serializer (formatProposalBody +
  // serializeTransactionsForBody) the submitter uses at signature time —
  // single shared serializer, no parallel size-accounting path. R3 calls
  // for this counter as an early-feedback signal; the hard gate lives in
  // SnapshotSubmitter so editing doesn't get blocked on a QCI save (which
  // writes to IPFS + registry, neither of which has the Snapshot limit).
  //
  // Pessimistic in two small ways: when implementor / implementation-date
  // are unset, we emit "None" so the frontmatter row is omitted (matching
  // the submitter's behavior); and we fall back to today's date for
  // created if no existing QCI is loaded.
  const projectedEmbeddedBody = useMemo(() => {
    const frontmatter = {
      chain: combooxSelectedChain,
      author: author || "",
      implementor,
      "implementation-date": existingQCI?.content["implementation-date"] || "None",
      created: existingQCI?.content.created || new Date().toISOString().split("T")[0],
    };
    const serializedTxs = serializeTransactionsForBody(transactions);
    return formatProposalBody(content, frontmatter, serializedTxs);
  }, [content, combooxSelectedChain, author, implementor, existingQCI, transactions]);
  const editorBodyLength = projectedEmbeddedBody.length;
  const editorBodyLimit = config.snapshotBodyLimitDefault;
  const editorOverLimit = editorBodyLength > editorBodyLimit;
  const editorNearLimit =
    !editorOverLimit && editorBodyLength >= Math.floor(editorBodyLimit * EDITOR_BODY_WARNING_RATIO);

  // Initialize transactions from existing QCI content
  useEffect(() => {
    if (existingQCI?.content.content) {
      try {
        // Extract transactions from the markdown content
        const transactionsMatch = existingQCI.content.content.match(/##\s*Transactions\s*\n+```json\s*\n([\s\S]+?)\n```/);

        if (transactionsMatch) {
          let transactionsJson = JSON.parse(transactionsMatch[1]);

          // Handle double-nested array bug from older versions
          if (Array.isArray(transactionsJson) && transactionsJson.length === 1 && Array.isArray(transactionsJson[0])) {
            transactionsJson = transactionsJson[0];
          }

          if (Array.isArray(transactionsJson)) {
            // Check if it's the new multisig-grouped format
            const isNewFormat = transactionsJson.length > 0 &&
                              'multisig' in transactionsJson[0] &&
                              'transactions' in transactionsJson[0];

            if (isNewFormat) {
              // New format: flatten all transactions from all groups
              const allTransactions: TransactionData[] = [];
              transactionsJson.forEach((group: any) => {
                group.transactions.forEach((tx: any) => {
                  const parsed = ABIParser.parseTransaction(JSON.stringify(tx));
                  // Preserve the multisig from the group
                  parsed.multisig = group.multisig;
                  allTransactions.push(parsed);
                });
              });
              setTransactions(allTransactions);
            } else {
              // Legacy format: array of transactions
              const parsedTransactions = transactionsJson.map((tx) => {
                const txString = JSON.stringify(tx);
                return ABIParser.parseTransaction(txString);
              });
              setTransactions(parsedTransactions);
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse existing transactions:', error);
        // Don't block the editor if transaction parsing fails
      }
    }
  }, [existingQCI]);

  // Add a safety timeout to clear saving state if it gets stuck
  useEffect(() => {
    if (saving) {
      const timeout = setTimeout(() => {
        console.warn("Saving operation timed out after 30 seconds");
        setSaving(false);
        if (!success && !error) {
          setError("Operation timed out. Please check if your transaction was successful.");
        }
      }, 30000); // 30 second timeout

      return () => clearTimeout(timeout);
    }
  }, [saving, success, error]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      // Reset navigation flag for new submission
      hasNavigatedRef.current = false;

      if (!address) {
        setError("Please connect your wallet");
        return;
      }

      setError(null);
      setSuccess(null);
      setSaving(true);

      try {
        // Serialize transaction groups as a string for QCIContent. The same
        // helper is used by the advisory counter below so the editor's
        // projected Snapshot-body length matches what eventually goes on the
        // wire — single shared serializer, no parallel path.
        const serializedTransactions = serializeTransactionsForBody(transactions);

        // Create QCI content object
        const qciContent: QCIContent = {
          qci: existingQCI?.qciNumber ? Number(existingQCI.qciNumber) : 0,
          title,
          chain: combooxSelectedChain,
          status: existingQCI ? existingQCI.content.status : "Draft",
          author: author,
          implementor,
          "implementation-date": existingQCI ? existingQCI.content["implementation-date"] : "None",
          proposal: existingQCI ? existingQCI.content.proposal : "None",
          created: existingQCI ? existingQCI.content.created : new Date().toISOString().split("T")[0],
          content,
          transactions: serializedTransactions,
        };

        let result;
        if (existingQCI) {
          // Update existing QCI
          result = await updateQCIMutation.mutateAsync({
            qciNumber: existingQCI.qciNumber,
            content: qciContent,
          });
        } else {
          // Create new QCI
          result = await createQCIMutation.mutateAsync({
            content: qciContent,
          });
        }

        const { qciNumber, transactionHash: txHash } = result;

        // Show success toast and navigate (prevent multiple navigations)
        if (!hasNavigatedRef.current) {
          if (existingQCI) {
            toast.success(`QCI updated successfully!`);
            hasNavigatedRef.current = true;
            navigate(`/qcis/${qciNumber}`, {
              state: {
                txHash,
                justUpdated: true,
                timestamp: Date.now(),
              },
            });
          } else {
            if (qciNumber > 0) {
              toast.success(`QCI created successfully!`);
              hasNavigatedRef.current = true;
              navigate(`/qcis/${qciNumber}`, {
                state: {
                  txHash,
                  justCreated: true,
                  timestamp: Date.now(),
                },
              });
            } else {
              toast.success(`QCI submitted! Check transaction for QCI number.`);
              setSuccess(`Transaction: ${txHash}`);
            }
          }
        }

        // Reset form only for new QCIs that don't redirect
        if (!existingQCI && qciNumber === 0n) {
          setTitle("");
          setContent("");
          setImplementor("None");
        }
      } catch (err: any) {
        console.error("Error saving QCI:", err);

        let errorMessage = err.message || "Failed to save QCI";
        if (errorMessage.includes("Content already exists")) {
          errorMessage = "A QCI with identical content already exists. Please modify your proposal content to make it unique.";
        }
        setError(errorMessage);
      } finally {
        setSaving(false);
      }
    },
    [address, title, combooxSelectedChain, content, implementor, existingQCI, transactions, author, createQCIMutation, updateQCIMutation, navigate]
  );

  const handlePreview = () => {
    setPreview(!preview);
  };

  const handleAddTransaction = (transaction: TransactionData) => {
    if (editingTransactionIndex !== null) {
      const updated = [...transactions];
      updated[editingTransactionIndex] = transaction;
      setTransactions(updated);
      setEditingTransactionIndex(null);
    } else {
      setTransactions([...transactions, transaction]);
    }
  };

  const handleEditTransaction = (index: number) => {
    setEditingTransactionIndex(index);
    setShowTransactionModal(true);
  };

  const handleDeleteTransaction = (index: number) => {
    setTransactions(transactions.filter((_, i) => i !== index));
  };

  if (!isConnected) {
    return (
      <Alert className="border-yellow-400 bg-yellow-500/10">
        <AlertDescription className="text-yellow-700 dark:text-yellow-400">
          Please connect your wallet to create or edit QCIs
        </AlertDescription>
      </Alert>
    );
  }

  if (!registryAddress) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error: Registry address not configured. Please restart Gatsby to load environment variables.</AlertDescription>
      </Alert>
    );
  }

  if (isWrongChain) {
    return (
      <Alert className="border-yellow-400 bg-yellow-500/10">
        <AlertDescription className="text-yellow-700 dark:text-yellow-400">
          <p className="mb-2">Please switch to Local Base Fork network (Chain ID: 8453)</p>
          <Button onClick={handleSwitchChain} variant="default">
            Switch to Local Base Fork
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-4 border-green-400 bg-green-100 text-green-700">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Improve QiDAO Collateral Framework"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="chain">Chain *</Label>
          <ChainCombobox value={combooxSelectedChain} onChange={setComboboxSelectedChain} placeholder="Select or type a chain..." />
        </div>

        <div className="space-y-2">
          <Label htmlFor="implementor">Implementor</Label>
          <Input
            type="text"
            id="implementor"
            value={implementor}
            onChange={(e) => setImplementor(e.target.value)}
            placeholder="Dev team, DAO, or None"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="content">Proposal Content (Markdown) *</Label>
          <Textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={20}
            className="font-mono text-sm"
            placeholder={`## Summary

Brief overview of your proposal...

## Abstract

Detailed explanation...

## Rationale

Why this proposal is needed...

## Technical Specification

Implementation details...`}
          />
          {/* Advisory Snapshot-body counter — informational only, no gating.
              Routes through the same shared serializer the submitter uses;
              tooltip clarifies that the authoritative check happens at
              Snapshot submission. */}
          <div className="flex items-center justify-end text-xs">
            <span
              className={
                editorOverLimit
                  ? "text-destructive"
                  : editorNearLimit
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              }
              aria-live="polite"
              title="Advisory projection — final count is checked at Snapshot submit."
            >
              Snapshot body: {editorBodyLength.toLocaleString()} / {editorBodyLimit.toLocaleString()} chars
              {editorOverLimit && " — over Snapshot limit"}
            </span>
          </div>
        </div>

        {/* Transactions Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Transactions</Label>
            <Button
              type="button"
              onClick={() => {
                setEditingTransactionIndex(null);
                setShowTransactionModal(true);
              }}
              variant="outline"
              size="sm"
            >
              <Plus size={16} />
              Add Transaction
            </Button>
          </div>

          {transactions.length > 0 ? (
            <TransactionGroup
              transactions={transactions}
              mode="edit"
              defaultOpen={false}
              onEdit={handleEditTransaction}
              onDelete={handleDeleteTransaction}
            />
          ) : (
            <p className="text-sm text-muted-foreground mb-4">
              No transactions added. Click "Add Transaction" to include on-chain transactions with this proposal.
            </p>
          )}
        </div>

        <div className="flex space-x-4">
          <Button type="submit" disabled={saving} variant="gradient-primary" size="lg">
            {saving ? "Saving..." : existingQCI ? "Update QCI" : "Create QCI"}
          </Button>

          <Button type="button" onClick={handlePreview} variant="outline" size="lg">
            {preview ? "Edit" : "Preview"}
          </Button>
        </div>
      </form>

      {preview && (
        <div className="mt-8 border-t pt-8">
          <h3 className="text-xl font-bold mb-4">Preview</h3>
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-2">{title || "Untitled"}</h1>
            <div className="text-sm text-muted-foreground mb-4">
              <span>Chain: {combooxSelectedChain}</span> •<span> Author: {author || address}</span> •<span> Status: Draft</span>
            </div>
            <div className="prose dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>

            {/* Show transactions in preview */}
            {transactions.length > 0 && (
              <div className="mt-8 pt-6 border-t border-border">
                <h2 className="text-xl font-bold mb-4">Transactions</h2>
                <pre className="bg-muted/50 p-4 rounded-lg overflow-x-auto">
                  <code className="text-sm font-mono">
                    {JSON.stringify(
                      // Group transactions by multisig for preview
                      groupTransactionsByMultisig(transactions).map(group => ({
                        multisig: group.multisig,
                        transactions: group.transactions.map((tx) => {
                          const formatted = ABIParser.formatTransaction(tx);
                          try {
                            return JSON.parse(formatted);
                          } catch {
                            return formatted;
                          }
                        }),
                      })),
                      null,
                      2
                    )}
                  </code>
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transaction Formatter Modal */}
      <TransactionFormatter
        isOpen={showTransactionModal}
        onClose={() => {
          setShowTransactionModal(false);
          setEditingTransactionIndex(null);
        }}
        onAdd={handleAddTransaction}
        networks={getAllChainNames()}
        editingTransaction={editingTransactionIndex !== null ? transactions[editingTransactionIndex] : undefined}
      />
    </div>
  );
};