import React, { useState, useEffect, useCallback, useRef, useMemo, useImperativeHandle } from 'react';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TransactionFormatter } from "./TransactionFormatter";
import { TransactionGroup } from "./TransactionGroup";
import { type TransactionData, ABIParser } from "../utils/abiParser";
import { groupTransactionsByMultisig, serializeTransactionsForBody } from "../utils/transactionParser";
import { formatProposalBody } from "../utils/snapshotPayload";
import { SNAPSHOT_BODY_WARNING_RATIO } from "@/config/env";
import { Info, Plus } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAllChainNames } from '@/config/proposalChains';

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

/**
 * Imperative handle exposed by SnapshotBodySection so the parent can read
 * the latest content at submit time, reset it after a successful save, and
 * (opt-in) subscribe to content changes while the rich preview block is
 * mounted — without re-rendering the parent on every keystroke.
 */
export interface SnapshotBodySectionHandle {
  getContent: () => string;
  setContent: (next: string) => void;
  /** Subscribe to content changes. Returns an unsubscribe function. */
  subscribe: (cb: (content: string) => void) => () => void;
}

interface SnapshotBodyFrontmatter {
  chain: string;
  author: string;
  implementor: string;
  "implementation-date": string;
  created: string;
}

interface SnapshotBodySectionProps {
  initialContent: string;
  frontmatter: SnapshotBodyFrontmatter;
  serializedTxs: string | undefined;
  bodyLimit: number;
  onOverLimitChange: (over: boolean) => void;
}

// How long the projection waits after the last keystroke before recomputing.
// 250ms is long enough to skip every intermediate keystroke during a paste
// burst but short enough that the counter "feels live" once typing pauses.
const COUNTER_DEBOUNCE_MS = 250;

interface BodyMeterProps {
  bodyLength: number;
  bodyLimit: number;
  frontmatterChars: number;
  contentCharsValue: number;
  txCharContribution: number;
  overLimit: boolean;
  nearLimit: boolean;
}

/**
 * Counter + breakdown tooltip subtree. Wrapped in React.memo so it doesn't
 * re-reconcile on every textarea keystroke — Radix's TooltipProvider tree
 * contains ~180 internal Primitive.div / SlotClone wrappers per React Scan,
 * and re-rendering all of them per keystroke was a big chunk of the cost.
 * Now this subtree only re-renders when its derived props change, which is
 * only when the debounced projection catches up (every COUNTER_DEBOUNCE_MS
 * idle period).
 */
const BodyMeter = React.memo(function BodyMeter({
  bodyLength,
  bodyLimit,
  frontmatterChars,
  contentCharsValue,
  txCharContribution,
  overLimit,
  nearLimit,
}: BodyMeterProps) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span
        className={`text-xs ${
          overLimit
            ? "text-destructive"
            : nearLimit
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
        }`}
        aria-live="polite"
        title="Advisory projection — final count is checked at Snapshot submit."
      >
        Snapshot body: {bodyLength.toLocaleString()} / {bodyLimit.toLocaleString()} chars
        {overLimit && " — over Snapshot limit"}
      </span>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Snapshot body character breakdown"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="end" className="max-w-xs">
            <div className="space-y-1.5">
              <div className="font-semibold">Snapshot body breakdown</div>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                <span>YAML frontmatter</span>
                <span className="text-right tabular-nums">{frontmatterChars.toLocaleString()}</span>
                <span>Proposal content</span>
                <span className="text-right tabular-nums">{contentCharsValue.toLocaleString()}</span>
                {txCharContribution > 0 && (
                  <>
                    <span>Transactions block</span>
                    <span className="text-right tabular-nums">{txCharContribution.toLocaleString()}</span>
                  </>
                )}
                <span className="border-t border-primary-foreground/20 pt-0.5 font-medium">Total</span>
                <span className="border-t border-primary-foreground/20 pt-0.5 text-right font-medium tabular-nums">
                  {bodyLength.toLocaleString()} / {bodyLimit.toLocaleString()}
                </span>
              </div>
              <div className="pt-1 text-[10px] opacity-80">
                Frontmatter and transactions are emitted by the Snapshot serializer in addition to your markdown content. Advisory projection — the submitter does the final check.
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
});

/**
 * Owns the textarea state, the live char counter, and the breakdown tooltip.
 * Wrapped in React.memo + ref so per-keystroke updates stay isolated to this
 * subtree and don't drag the parent ProposalEditor's other children
 * (ChainCombobox, Transactions section, TransactionFormatter modal, the
 * Radix slot primitives) through reconciliation.
 *
 * The projection memos read a setTimeout-debounced copy of content so they
 * don't run on every keystroke — useDeferredValue alone wasn't enough
 * because it still committed the deferred render at low priority, and the
 * Radix Tooltip subtree underneath the counter has enough internal wrappers
 * that even a fast re-reconcile per keystroke costs noticeable ms in dev.
 * The BodyMeter subcomponent is React.memo so it skips re-render entirely
 * unless its derived props change.
 *
 * The parent reads content via `ref.current.getContent()` at submit time
 * and pushes content back via `ref.current.setContent()` when an existing
 * QCI's data loads asynchronously.
 */
const SnapshotBodySection = React.memo(
  React.forwardRef<SnapshotBodySectionHandle, SnapshotBodySectionProps>(
    function SnapshotBodySection(
      { initialContent, frontmatter, serializedTxs, bodyLimit, onOverLimitChange },
      ref
    ) {
      const [content, setContent] = useState(initialContent);
      // Debounced copy of content. The textarea binds to `content` for
      // snappy input; projection memos read `debouncedContent` so they
      // only run after typing has paused for COUNTER_DEBOUNCE_MS.
      const [debouncedContent, setDebouncedContent] = useState(initialContent);
      useEffect(() => {
        const t = setTimeout(() => setDebouncedContent(content), COUNTER_DEBOUNCE_MS);
        return () => clearTimeout(t);
      }, [content]);

      // Opt-in subscribers (e.g., the rich preview block) that want
      // content updates without forcing the parent to re-render per
      // keystroke. We notify them in an effect so React owns the timing.
      const subscribersRef = useRef<Set<(content: string) => void>>(new Set());
      useEffect(() => {
        for (const cb of subscribersRef.current) cb(content);
      }, [content]);

      const projectedEmbeddedBody = useMemo(
        () => formatProposalBody(debouncedContent, frontmatter, serializedTxs),
        [debouncedContent, frontmatter, serializedTxs]
      );
      const projectedBodyWithoutTxs = useMemo(
        () => formatProposalBody(debouncedContent, frontmatter, undefined),
        [debouncedContent, frontmatter]
      );
      const projectedBodyFrontmatterOnly = useMemo(
        () => formatProposalBody("", frontmatter, undefined),
        [frontmatter]
      );

      const editorBodyLength = projectedEmbeddedBody.length;
      const frontmatterChars = projectedBodyFrontmatterOnly.length;
      const contentCharsValue = projectedBodyWithoutTxs.length - projectedBodyFrontmatterOnly.length;
      const txCharContribution = projectedEmbeddedBody.length - projectedBodyWithoutTxs.length;
      const overLimit = editorBodyLength > bodyLimit;
      const nearLimit = !overLimit && editorBodyLength >= Math.floor(bodyLimit * SNAPSHOT_BODY_WARNING_RATIO);

      // Notify the parent only when the over-limit flag actually flips, so
      // the parent's Update/Create button can disable without subscribing
      // to every keystroke.
      useEffect(() => {
        onOverLimitChange(overLimit);
      }, [overLimit, onOverLimitChange]);

      useImperativeHandle(
        ref,
        () => ({
          getContent: () => content,
          setContent,
          subscribe: (cb) => {
            subscribersRef.current.add(cb);
            return () => {
              subscribersRef.current.delete(cb);
            };
          },
        }),
        [content]
      );

      return (
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
          <BodyMeter
            bodyLength={editorBodyLength}
            bodyLimit={bodyLimit}
            frontmatterChars={frontmatterChars}
            contentCharsValue={contentCharsValue}
            txCharContribution={txCharContribution}
            overLimit={overLimit}
            nearLimit={nearLimit}
          />
        </div>
      );
    }
  )
);
SnapshotBodySection.displayName = "SnapshotBodySection";

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
  // Initial value passed into SnapshotBodySection on mount. The child owns
  // the live content state from this point; the parent reads it via
  // bodyRef.current.getContent() at submit time, and pushes updates back
  // via bodyRef.current.setContent() when existingQCI loads asynchronously.
  const initialContentValue = existingQCI?.content.content
    ? getContentWithoutTransactions(existingQCI.content.content)
    : importedData?.content || initialContent || "";
  const [implementor, setImplementor] = useState(
    existingQCI?.content.implementor || importedData?.implementor || initialImplementor || "None"
  );
  const [author] = useState(existingQCI?.content.author || address || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // Subscribe the preview block to body content changes ONLY while preview
  // is open. This keeps typing fast in the default case (preview off, no
  // parent re-renders per keystroke). When preview is on, the parent does
  // re-render per keystroke so ReactMarkdown stays current — that's the
  // acknowledged tradeoff and only happens when the user has explicitly
  // opted into the slower preview view.
  useEffect(() => {
    if (!preview) return;
    setPreviewContent(bodyRef.current?.getContent() ?? "");
    return bodyRef.current?.subscribe(setPreviewContent);
  }, [preview]);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [editingTransactionIndex, setEditingTransactionIndex] = useState<number | null>(null);

  const queryClient = useQueryClient();

  // Initialize mutation hooks
  const createQCIMutation = useCreateQCI({ registryAddress });
  const updateQCIMutation = useUpdateQCI({ registryAddress });

  // Advisory Snapshot-body projection — same shared serializer the submitter
  // uses at signature time. The hard gate lives in SnapshotSubmitter; this
  // counter is informational so editing isn't blocked on a QCI save.
  //
  // Split into two memos so the per-keystroke `content` change doesn't
  // re-run the transaction serialization (which round-trips through
  // ABIParser per tx).
  const serializedTxsForCounter = useMemo(
    () => serializeTransactionsForBody(transactions),
    [transactions]
  );
  const existingImplementationDate = existingQCI?.content["implementation-date"];
  const existingCreated = existingQCI?.content.created;
  const editorFrontmatter = useMemo(
    () => ({
      chain: combooxSelectedChain,
      author: author || "",
      implementor,
      "implementation-date": existingImplementationDate || "None",
      created: existingCreated || new Date().toISOString().split("T")[0],
    }),
    [combooxSelectedChain, author, implementor, existingImplementationDate, existingCreated]
  );
  // Content state lives inside <SnapshotBodySection>; the parent reads it
  // imperatively via this ref at submit time. This prevents the parent
  // (and its other children — ChainCombobox, Transactions section,
  // TransactionFormatter modal, Radix slot primitives) from re-rendering
  // on every keystroke. React Scan profile confirmed those non-content
  // children were costing 1-3ms each per keystroke; isolating the
  // textarea cuts the per-frame work to just the body section's subtree.
  const bodyRef = useRef<SnapshotBodySectionHandle>(null);
  const [isContentOverLimit, setIsContentOverLimit] = useState(false);
  const handleOverLimitChange = useCallback((over: boolean) => {
    setIsContentOverLimit(over);
  }, []);

  // Live content mirror for the rich preview block ONLY. We subscribe to the
  // body section's content updates while the preview is open, and unsubscribe
  // when it closes. When preview is off, no subscription is active and
  // typing in the textarea never re-renders this parent.
  const [previewContent, setPreviewContent] = useState("");

  const editorBodyLimit = config.snapshotBodyLimitDefault;

  // Tx-contribution badge for the Transactions section header. Computed
  // without `content` because the JSON tx block in formatProposalBody is
  // content-independent: the difference between with-txs and without-txs
  // bodies on an empty content cancels out the YAML and leaves the pure
  // tx-block contribution. Updates only when txs or frontmatter change,
  // not per keystroke.
  const txCharContribution = useMemo(() => {
    const withTxs = formatProposalBody("", editorFrontmatter, serializedTxsForCounter);
    const withoutTxs = formatProposalBody("", editorFrontmatter, undefined);
    return withTxs.length - withoutTxs.length;
  }, [editorFrontmatter, serializedTxsForCounter]);

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

      // A QCI saved over the Snapshot body limit can never be submitted to
      // Snapshot — block save here so we don't write wasted content to IPFS
      // + the registry. Read the URGENT content via the body section's ref
      // (the child's display counter is debounced and lags up to ~250ms); a
      // fast typist who clicks Save during that lag must still get gated.
      const content = bodyRef.current?.getContent() ?? "";
      const freshBody = formatProposalBody(content, editorFrontmatter, serializedTxsForCounter);
      if (freshBody.length > editorBodyLimit) {
        setError(
          `Proposal body is ${freshBody.length.toLocaleString()} chars — over Snapshot's ${editorBodyLimit.toLocaleString()}-char limit. Shorten before saving.`
        );
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
          bodyRef.current?.setContent("");
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
    [address, title, combooxSelectedChain, implementor, existingQCI, transactions, author, createQCIMutation, updateQCIMutation, navigate, editorFrontmatter, serializedTxsForCounter, editorBodyLimit]
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

        <SnapshotBodySection
          ref={bodyRef}
          initialContent={initialContentValue}
          frontmatter={editorFrontmatter}
          serializedTxs={serializedTxsForCounter}
          bodyLimit={editorBodyLimit}
          onOverLimitChange={handleOverLimitChange}
        />

        {/* Transactions Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <Label>Transactions</Label>
              {transactions.length > 0 && (
                <span
                  className="text-xs text-muted-foreground"
                  title="Characters this transactions block contributes to the Snapshot body — when offload mode lands in PR-B, this is the bulk that gets reclaimed."
                >
                  +{txCharContribution.toLocaleString()} chars to Snapshot body
                </span>
              )}
            </div>
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
          <Button type="submit" disabled={saving || isContentOverLimit} variant="gradient-primary" size="lg">
            {saving
              ? "Saving..."
              : isContentOverLimit
              ? `Body over Snapshot limit (${editorBodyLimit.toLocaleString()})`
              : existingQCI
              ? "Update QCI"
              : "Create QCI"}
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown>
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