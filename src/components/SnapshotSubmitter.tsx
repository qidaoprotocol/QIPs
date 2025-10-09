import React, { useState } from "react";
import { useEthersSigner } from "../utils/ethers";
import { createProposal } from "../utils/snapshotClient";
import { Proposal } from "@snapshot-labs/snapshot.js/dist/src/sign/types";
import { ethers } from "ethers";
import { useQuery } from "@tanstack/react-query";
import { config } from "../config";
import { Card, CardContent, CardFooter } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useLinkSnapshotProposal } from "../hooks/useLinkSnapshotProposal";
import { getLatestQipNumber } from "../utils/snapshotClient";
import { useQITokenBalance } from "../hooks/useQITokenBalance";

interface SnapshotSubmitterProps {
  frontmatter: any;
  html: string;
  rawMarkdown: string;
  onStatusUpdate?: () => void;
  registryAddress?: `0x${string}`;
  rpcUrl?: string;
  isAuthor?: boolean;
  isEditor?: boolean;
}

const SnapshotSubmitter: React.FC<SnapshotSubmitterProps> = ({
  frontmatter,
  html,
  rawMarkdown,
  onStatusUpdate,
  registryAddress,
  rpcUrl,
  isAuthor = false,
  isEditor = false,
}) => {
  const signer = useEthersSigner();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<React.ReactNode>(null);
  const [showStatusUpdatePrompt, setShowStatusUpdatePrompt] = useState(false);
  const [proposalUrl, setProposalUrl] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusLevel, setStatusLevel] = useState<"info" | "success" | "error" | null>(null);

  // Mutation hook for linking snapshot proposals
  const linkSnapshotMutation = useLinkSnapshotProposal({
    registryAddress: registryAddress as `0x${string}`,
  });

  // Fetch the next QIP number using React Query
  const {
    data: latestQipNumber,
    isLoading: isLoadingQipNumber,
    refetch: refetchQipNumber,
  } = useQuery({
    queryKey: ["latestQipNumber"],
    queryFn: getLatestQipNumber,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 300000, // Refetch every 5 minutes
  });

  const nextQipNumber = latestQipNumber ? latestQipNumber + 1 : 1;
  const previewQipTitle = `QIP${nextQipNumber}: ${frontmatter.title}`;

  // Determine which space to use based on test mode
  const isTestMode = config.snapshotTestMode;
  const SNAPSHOT_SPACE = isTestMode ? config.snapshotTestSpace : config.snapshotSpace;

  // Use global QI token balance hook (pre-cached on site load)
  const { tokenBalance, isLoading: checkingBalance, requiresTokenBalance, requiredBalance } = useQITokenBalance();

  const formatProposalBody = (rawMarkdown: string, frontmatter: any, transactions?: string | string[]) => {
    // Remove frontmatter from the beginning of the markdown
    let content = rawMarkdown.replace(/^---[\s\S]*?---\n?/, "").trim();

    // Remove title if it appears at the beginning of the content
    // This handles various title formats like "## QIP247 Title" or "## **QIP247 Title**"
    content = content.replace(/^##\s*\*?\*?QIP\d+[:\s].*?\*?\*?\n+/i, "");

    // Build YAML frontmatter for the proposal body
    const yamlFields = [];
    yamlFields.push("---");

    // Use "network" instead of "chain"
    if (frontmatter.chain) {
      yamlFields.push(`network: ${frontmatter.chain}`);
    }

    if (frontmatter.author) {
      yamlFields.push(`author: ${frontmatter.author}`);
    }

    // Only include implementor if it's not "None"
    if (frontmatter.implementor && frontmatter.implementor !== "None") {
      yamlFields.push(`implementor: ${frontmatter.implementor}`);
    }

    // Only include implementation-date if it's not "None"
    if (frontmatter["implementation-date"] && frontmatter["implementation-date"] !== "None") {
      yamlFields.push(`implementation-date: ${frontmatter["implementation-date"]}`);
    }

    if (frontmatter.created) {
      yamlFields.push(`created: ${frontmatter.created}`);
    }

    yamlFields.push("---");

    // Build the full body with YAML frontmatter
    let fullBody = yamlFields.join("\n") + "\n\n" + content;

    // Add transactions if present - now supporting multisig-grouped format
    if (transactions) {
      fullBody += "\n\n## Transactions\n\n";

      try {
        let parsed: any;

        // Handle both string (new) and string[] (old) formats
        if (typeof transactions === 'string') {
          // New format: direct string
          parsed = JSON.parse(transactions);
        } else if (Array.isArray(transactions) && transactions.length > 0) {
          // Old format: string array
          parsed = JSON.parse(transactions[0]);
        } else {
          // Invalid format
          parsed = [];
        }

        // Check if it's the new multisig-grouped format
        if (Array.isArray(parsed) && parsed.length > 0 && 'multisig' in parsed[0] && 'transactions' in parsed[0]) {
          // New format: group by multisig
          parsed.forEach((group: any, groupIndex: number) => {
            if (group.multisig) {
              fullBody += `### Multisig: \`${group.multisig}\`\n\n`;
            }

            group.transactions.forEach((tx: any, txIndex: number) => {
              const txNum = groupIndex > 0 ? `${groupIndex + 1}.${txIndex + 1}` : `${txIndex + 1}`;
              fullBody += `**Transaction ${txNum}**`;

              // Add annotation if present
              if (tx.annotation) {
                fullBody += `\n\n*${tx.annotation}*`;
              }

              fullBody += `\n\n\`\`\`json\n${JSON.stringify(tx, null, 2)}\n\`\`\`\n\n`;
            });
          });
        } else if (Array.isArray(parsed)) {
          // Legacy format: simple array of transactions
          parsed.forEach((tx: any, index: number) => {
            fullBody += `### Transaction ${index + 1}\n\`\`\`json\n${JSON.stringify(tx, null, 2)}\n\`\`\`\n\n`;
          });
        }
      } catch (error) {
        // Fallback: treat as legacy format string array
        if (Array.isArray(transactions)) {
          transactions.forEach((tx, index) => {
            fullBody += `### Transaction ${index + 1}\n\`\`\`\n${tx}\n\`\`\`\n\n`;
          });
        }
      }
    }

    return fullBody;
  };

  const space = SNAPSHOT_SPACE;

  // Extract transactions from frontmatter if available
  const extractTransactions = () => {
    if (frontmatter.transactions) {
      // Return as-is (can be string or string[])
      return frontmatter.transactions;
    }
    return undefined;
  };

  const handleSubmit = async () => {
    if (!signer) {
      setStatus("Please connect your wallet first.");
      setStatusLevel("info");
      return;
    }
    setLoading(true);
    setStatus(
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Fetching next QIP number...</span>
      </div>
    );
    setStatusLevel("info");

    try {
      // Refetch to ensure we have the latest QIP number
      await refetchQipNumber();

      const qipTitle = previewQipTitle;

      setStatus(
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Preparing {qipTitle} for submission...</span>
        </div>
      );
      setStatusLevel("info");
      // Always use Ethereum mainnet blocks for all Snapshot proposals
      const ethProvider = new ethers.providers.JsonRpcProvider("https://eth.llamarpc.com");
      const snapshotBlock = await ethProvider.getBlockNumber();

      // Calculate timestamps right before submission
      const now = Math.floor(Date.now() / 1000);
      const startOffset = 86400; // Exactly 24 hours
      const endOffset = 345600; // Exactly 4 days

      // Extract transactions for the body
      const transactions = extractTransactions();

      const proposalOptions: Proposal = {
        space,
        type: "basic",
        title: qipTitle,
        body: formatProposalBody(rawMarkdown, frontmatter, transactions),
        choices: ["For", "Against", "Abstain"],
        start: now + startOffset,
        end: now + endOffset,
        snapshot: snapshotBlock, // Use the correct block number
        discussion: "",
        plugins: JSON.stringify({}),
        app: "snapshot-v2",
        timestamp: now, // Add explicit timestamp
      };

      const receipt = await createProposal(signer, "https://hub.snapshot.org", proposalOptions);

      if (receipt && (receipt as any).id) {
        const newProposalId = (receipt as any).id;

        const proposalUrl = `https://snapshot.org/#/${space}/proposal/${newProposalId}`;

        setProposalUrl(proposalUrl);

        setProposalId(newProposalId);

        // Refetch QIP number after successful submission
        refetchQipNumber();

        // Show success message and prompt for status update if user has permissions
        if (registryAddress && (isAuthor || isEditor)) {
          setShowStatusUpdatePrompt(true);
          setStatus(
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Proposal created successfully!</span>
              <a
                href={proposalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:text-primary/80 underline"
              >
                View proposal <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          );
          setStatusLevel("success");
        } else {
          setStatus(
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Proposal created successfully!</span>
              <a
                href={proposalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:text-primary/80 underline"
              >
                View proposal <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          );
          setStatusLevel("success");
        }
      } else {
        setStatus(`Proposal created: ${JSON.stringify(receipt)}`);
        setStatusLevel("success");
      }
    } catch (e: any) {
      console.error("Snapshot submission error:", e);
      if (e.error && e.error_description) {
        setStatus(`Error: ${e.error_description}`);
      } else if (e.code === "ACTION_REJECTED" || e.code === 4001) {
        setStatus("Transaction cancelled by user");
      } else {
        setStatus(`Error: ${e.message || "Failed to create proposal. Please try again."}`);
      }
      setStatusLevel("error");
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async () => {
    if (!registryAddress || !proposalId) {
      console.error("[SnapshotSubmitter] Cannot update status - missing required data:", {
        registryAddress: registryAddress || "MISSING",
        proposalId: proposalId || "MISSING",
      });

      // Show user-friendly error
      if (!proposalId) {
        setStatus(
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Error: No proposal ID found. Please create the proposal first.</span>
          </div>
        );
        setStatusLevel("error");
      } else if (!registryAddress) {
        setStatus(
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Error: Registry address not configured.</span>
          </div>
        );
        setStatusLevel("error");
      }
      return;
    }

    setIsUpdatingStatus(true);
    try {
      // Use the mutation hook to link the snapshot proposal
      await linkSnapshotMutation.mutateAsync({
        qciNumber: BigInt(frontmatter.qci),
        proposalId,
      });

      setShowStatusUpdatePrompt(false);

      // Trigger the parent's refresh callback
      if (onStatusUpdate) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for blockchain sync
        onStatusUpdate();
      }
    } catch (error: any) {
      console.error("[SnapshotSubmitter] Failed to link Snapshot proposal:", error);

      // Provide more specific error messages
      let errorMessage = "Unknown error";
      if (error?.message?.includes("out of gas") || error?.message?.includes("OutOfGas")) {
        errorMessage =
          "Transaction ran out of gas. In local development, make sure you are using an Anvil test account with sufficient ETH.";
      } else if (error?.message?.includes("user rejected") || error?.code === 4001) {
        errorMessage = "Transaction cancelled by user";
      } else if (error?.message) {
        errorMessage = error.message;
      }

      setStatus(
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>Failed to link Snapshot proposal: {errorMessage}</span>
        </div>
      );
      setStatusLevel("error");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const dismissStatusPrompt = () => {
    setShowStatusUpdatePrompt(false);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardContent className="space-y-4">
        {!isLoadingQipNumber && (
          <div className="p-5 px-0 rounded-lg">
            <div className="">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Will be submitted as</span>
              </div>
              <div className="space-y-1">
                <div className="text-xl font-bold text-foreground">{previewQipTitle}</div>
                <div className="text-xs text-muted-foreground">
                  Graduating QCI{frontmatter.qci} → QIP{nextQipNumber}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status Messages */}
        {status && (
          <div
            className={`p-4 rounded-lg border ${
              statusLevel === "error"
                ? "bg-destructive/10 border-destructive/20 text-destructive"
                : statusLevel === "success"
                ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-400"
                : "bg-muted/30 border-border text-muted-foreground"
            }`}
          >
            <div className="flex items-start gap-2">
              {statusLevel === "error" ? (
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : statusLevel === "success" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : null}
              <div className="flex-1">{status}</div>
            </div>
          </div>
        )}

        {/* Prerequisites Info */}
        {signer && requiresTokenBalance && tokenBalance >= requiredBalance && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Token balance: {tokenBalance.toLocaleString()} (meets requirement)</span>
            </div>
          </div>
        )}

        {/* Status Update Prompt */}
        {showStatusUpdatePrompt && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950 dark:border-blue-800">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 space-y-3">
                <div>
                  <h4 className="font-semibold text-blue-900 dark:text-blue-100">Link Snapshot Proposal?</h4>
                  <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                    Your proposal has been successfully submitted to Snapshot. Would you like to link this Snapshot proposal to the QCI and
                    update the status to "Posted to Snapshot"?
                  </p>
                  {proposalId && <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-mono">Proposal ID: {proposalId}</p>}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      handleStatusUpdate();
                    }}
                    disabled={isUpdatingStatus}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {isUpdatingStatus ? "Linking..." : "Link Proposal"}
                  </Button>
                  <Button onClick={dismissStatusPrompt} variant="outline" size="sm">
                    Skip
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          onClick={handleSubmit}
          disabled={
            !signer || (requiresTokenBalance && tokenBalance < requiredBalance) || loading || (requiresTokenBalance && checkingBalance)
          }
          className="w-full"
          size="xl"
          variant="gradient-primary"
        >
          {loading
            ? "Submitting..."
            : requiresTokenBalance && checkingBalance
            ? "Checking prerequisites..."
            : !signer
            ? "Connect Wallet"
            : requiresTokenBalance && tokenBalance < requiredBalance
            ? `Insufficient Balance (${tokenBalance.toLocaleString()} / ${requiredBalance.toLocaleString()} required)`
            : isTestMode
            ? `Submit Test QIP to ${SNAPSHOT_SPACE}`
            : `Submit QIP to ${SNAPSHOT_SPACE}`}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default SnapshotSubmitter;
