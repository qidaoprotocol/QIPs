import React, { useMemo, useState } from "react";
import { useEthersSigner } from "../utils/ethers";
import { createProposal } from "../utils/snapshotClient";
import { Proposal } from "@snapshot-labs/snapshot.js/dist/src/sign/types";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { config } from "../config";
import { Card, CardContent, CardFooter } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { base, mainnet } from "wagmi/chains";
import { useLinkSnapshotProposal } from "../hooks/useLinkSnapshotProposal";
import { getLatestQipNumber } from "../utils/snapshotClient";
import { useQITokenBalance } from "../hooks/useQITokenBalance";
import { ChainSwitchRejectedError, useEnsureChain } from "../hooks/useEnsureChain";
import { formatProposalBody } from "../utils/snapshotPayload";

// Warning threshold: render the counter in amber when the projected body
// reaches 80% of the limit. Below the threshold the counter stays muted;
// above the limit it turns destructive (red) and the submit button locks.
// Mirrors the canonical pattern from Comments/CommentComposer.tsx — the
// only difference is the unit (characters here, UTF-8 bytes there) because
// the Snapshot Sequencer gates on `body.length`, while the comments backend
// gates on byte length.
const WARNING_RATIO = 0.8;

/**
 * Structured local error type for Snapshot body-too-long rejections. Produced
 * by the two-tier match in handleSubmit (primary regex on the Sequencer's
 * `error_description`, plus a status+error-code heuristic that catches the
 * same condition even if Snapshot drifts the error wording). Surfaces in the
 * UI as a destructive Alert with the delivered/limit numbers so the user can
 * shorten and retry.
 */
interface SnapshotBodyTooLongError {
  delivered: number;
  limit: number;
}

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
  // Reuse the wagmi-managed mainnet client so we share its single ranked
  // fallback pool / observability loop instead of spawning a new one per
  // submission. The submit handler reads the current block from this client.
  const mainnetClient = usePublicClient({ chainId: mainnet.id });
  const { ensureChain } = useEnsureChain(base.id);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<React.ReactNode>(null);
  const [showStatusUpdatePrompt, setShowStatusUpdatePrompt] = useState(false);
  const [proposalUrl, setProposalUrl] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusLevel, setStatusLevel] = useState<"info" | "success" | "error" | null>(null);
  const [bodyTooLongError, setBodyTooLongError] = useState<SnapshotBodyTooLongError | null>(null);

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

  const space = SNAPSHOT_SPACE;

  // Extract transactions from frontmatter if available
  const extractTransactions = () => {
    if (frontmatter.transactions) {
      // Return as-is (can be string or string[])
      return frontmatter.transactions;
    }
    return undefined;
  };

  // Authoritative Snapshot body projection — the same string that goes on the
  // wire if the user submits right now. R2 requires this counter to measure
  // the wire payload, not the raw markdown, so we route through the shared
  // serializer (R8 / Key Technical Decisions: single shared serializer). The
  // counter and the actual snapshot.proposal() call both call this exact
  // function; no parallel size-accounting path exists.
  //
  // `body.length` is UTF-16 code units — matches the Sequencer's
  // `msg.payload.body.length` check, NOT UTF-8 bytes. Per R6.
  const projectedBody = useMemo(
    () => formatProposalBody(rawMarkdown, frontmatter, extractTransactions()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extractTransactions reads from frontmatter
    [rawMarkdown, frontmatter]
  );
  const bodyLength = projectedBody.length;
  // qidao.eth lives in the "verified" bucket per the live GraphQL Settings
  // query (verified=true, turbo=false). U7 (deferred) will hydrate this
  // dynamically; for now the active limit is the default-bucket value.
  const bodyLimit = config.snapshotBodyLimitDefault;
  const overLimit = bodyLength > bodyLimit;
  const nearLimit = !overLimit && bodyLength >= Math.floor(bodyLimit * WARNING_RATIO);

  const handleSubmit = async () => {
    if (!signer) {
      setStatus("Please connect your wallet first.");
      setStatusLevel("info");
      return;
    }

    // Defensive: the submit button is also disabled when overLimit is true,
    // but a parallel-state race (memo not yet flushed after a frontmatter
    // mutation) could let a click through. Recompute and abort before any
    // network or signature work fires.
    if (projectedBody.length > bodyLimit) {
      setBodyTooLongError({ delivered: projectedBody.length, limit: bodyLimit });
      setStatus(null);
      setStatusLevel(null);
      return;
    }

    // Clear any prior structured body-too-long error from a previous attempt.
    setBodyTooLongError(null);
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
      // Always use Ethereum mainnet blocks for all Snapshot proposals. Read
      // through the wagmi-managed mainnet client so the call uses the
      // configured pool/fallback transport instead of a hardcoded URL.
      if (!mainnetClient) {
        throw new Error("Mainnet public client unavailable — wagmi config missing mainnet transport.");
      }
      const snapshotBlock = Number(await mainnetClient.getBlockNumber());

      // Calculate timestamps right before submission
      const now = Math.floor(Date.now() / 1000);
      const startOffset = 86400; // Exactly 24 hours
      const endOffset = 345600; // Exactly 4 days

      // Extract transactions for the body
      const transactions = extractTransactions();

      // Build the FINAL wire body using the now-refreshed QIP number. The
      // earlier projectedBody memo used the render-time QIP number; if
      // refetchQipNumber rolled the digit count over (999 → 1000), the
      // title string grew by one character and the projected length is
      // stale. Recompute from the same single shared serializer and
      // abort BEFORE signature if the recomputed length now exceeds the
      // limit. This is the parallel-read-path-safe gate site.
      const wireBody = formatProposalBody(rawMarkdown, frontmatter, transactions);
      if (wireBody.length > bodyLimit) {
        setBodyTooLongError({ delivered: wireBody.length, limit: bodyLimit });
        setStatus(null);
        setStatusLevel(null);
        setLoading(false);
        return;
      }

      const proposalOptions: Proposal = {
        space,
        type: "basic",
        title: qipTitle,
        body: wireBody,
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

      // Two-tier body-too-long detection.
      //
      // Primary: regex on the Sequencer's `error_description` field. The
      // Sequencer's writer (snapshot-labs/sx-monorepo/apps/sequencer/src/
      // writer/proposal.ts) returns the exact string
      // "proposal body length can not exceed N characters" today, but treat
      // upstream wording as drift-prone — Snapshot is an external dependency
      // we don't version against.
      //
      // Secondary: if `error_description` is missing or the regex doesn't
      // match but the response is shaped like a Sequencer client-side
      // rejection (HTTP 4xx + `error === "client_error"`), AND the wire
      // body we built locally exceeded the configured limit, surface the
      // same structured CTA using the local limit as the assumed bound.
      // The wire body length isn't available here — we re-derive it from
      // the now-stale projectedBody, which is close enough for an
      // assumed-limit display.
      //
      // Both paths read defensively: try error_description first, fall
      // through to error.message, then to a stringified fallback.
      const errorString: string =
        (typeof e.error_description === "string" && e.error_description) ||
        (typeof e.message === "string" && e.message) ||
        (e !== null && e !== undefined ? String(e) : "");
      const lengthMatch = errorString.match(/proposal body length can not exceed (\d+) characters/i);

      const isClientError = typeof e.error === "string" && e.error === "client_error";
      const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : undefined;
      const isHttp4xx = typeof status === "number" && status >= 400 && status < 500;

      if (lengthMatch) {
        // Primary match: extract the server-reported limit verbatim.
        const serverLimit = parseInt(lengthMatch[1], 10) || bodyLimit;
        setBodyTooLongError({ delivered: projectedBody.length, limit: serverLimit });
        setStatus(null);
        setStatusLevel(null);
      } else if (isClientError && isHttp4xx && projectedBody.length > bodyLimit) {
        // Heuristic fallback: a Sequencer client-error with a 4xx status
        // and a body we know to be over the local limit — same condition,
        // just different wording.
        setBodyTooLongError({ delivered: projectedBody.length, limit: bodyLimit });
        setStatus(null);
        setStatusLevel(null);
      } else if (e.error && e.error_description) {
        setStatus(`Error: ${e.error_description}`);
        setStatusLevel("error");
      } else if (e.code === "ACTION_REJECTED" || e.code === 4001) {
        setStatus("Transaction cancelled by user");
        setStatusLevel("error");
      } else {
        setStatus(`Error: ${e.message || "Failed to create proposal. Please try again."}`);
        setStatusLevel("error");
      }
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
      // Make sure the wallet is on Base before estimating, simulating, or
      // writing. Mirrors the SIWE chain-switch pattern; prevents viem from
      // routing eth_estimateGas through the wallet's current-chain RPC
      // (e.g., polygon-rpc.com after a SIWE sign on a Polygon Safe).
      try {
        await ensureChain();
      } catch (chainError) {
        if (chainError instanceof ChainSwitchRejectedError) {
          setStatus(
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <span>Switch to Base to link the Snapshot proposal.</span>
            </div>
          );
          setStatusLevel("info");
          throw chainError;
        }
        throw chainError;
      }

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
      // The chain-switch path already set a quiet inline status; skip the
      // noisy error logging and overwrite.
      if (error instanceof ChainSwitchRejectedError) {
        return;
      }

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

        {/* Body-too-long structured error. Renders when the Snapshot
            Sequencer rejected the submission with a body-length error
            (primary regex match) or when the heuristic fallback fires.
            PR-B will extend this with an "Enable IPFS offload" CTA button;
            for now the message gives the user the limit info so they can
            shorten and retry. */}
        {bodyTooLongError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Snapshot rejected this body as too long (delivered{" "}
              {bodyTooLongError.delivered.toLocaleString()} chars, limit{" "}
              {bodyTooLongError.limit.toLocaleString()}). Shorten the title or proposal body and retry.
            </AlertDescription>
          </Alert>
        )}

        {/* Live character counter — measures the authoritative wire payload
            (the same string handleSubmit will send) via formatProposalBody.
            Hidden when the QIP number is still loading because the projected
            length depends on the QIP number in the title. */}
        {!isLoadingQipNumber && (
          <div className="flex items-center justify-between text-xs">
            <span
              className={
                overLimit
                  ? "text-destructive"
                  : nearLimit
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              }
              aria-live="polite"
            >
              Snapshot body: {bodyLength.toLocaleString()} / {bodyLimit.toLocaleString()} chars
              {overLimit && " — too long"}
            </span>
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
            !signer ||
            (requiresTokenBalance && tokenBalance < requiredBalance) ||
            loading ||
            (requiresTokenBalance && checkingBalance) ||
            overLimit
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
            : overLimit
            ? `Body too long (${bodyLength.toLocaleString()} / ${bodyLimit.toLocaleString()} chars)`
            : isTestMode
            ? `Submit Test QIP to ${SNAPSHOT_SPACE}`
            : `Submit QIP to ${SNAPSHOT_SPACE}`}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default SnapshotSubmitter;
