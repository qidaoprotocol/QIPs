import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { AlertCircle, CheckCircle2, Edit3, Loader2 } from "lucide-react";
import { useUpdateSnapshotProposal } from "../hooks/useUpdateSnapshotProposal";
import { toast } from "sonner";

interface SnapshotModeratorProps {
  qciNumber: number;
  currentProposalId: string;
  registryAddress: `0x${string}`;
  onSuccess?: () => void;
}

const SnapshotModerator: React.FC<SnapshotModeratorProps> = ({
  qciNumber,
  currentProposalId,
  registryAddress,
  onSuccess,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newProposalId, setNewProposalId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const updateSnapshotMutation = useUpdateSnapshotProposal({
    registryAddress,
  });

  const handleUpdate = async () => {
    if (!newProposalId.trim()) {
      setError("Please enter a new Snapshot proposal ID");
      return;
    }

    if (!reason.trim()) {
      setError("Please provide a reason for this update");
      return;
    }

    if (newProposalId === currentProposalId) {
      setError("New proposal ID must be different from the current one");
      return;
    }

    setIsUpdating(true);
    setError(null);

    try {
      // Use the mutation hook to update the snapshot proposal
      await updateSnapshotMutation.mutateAsync({
        qciNumber: BigInt(qciNumber),
        newProposalId,
        reason,
      });

      toast.success("Snapshot proposal updated successfully", {
        description: `Updated from ${currentProposalId} to ${newProposalId}`,
      });

      // Reset form
      setShowForm(false);
      setNewProposalId("");
      setReason("");

      // Call success callback
      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      console.error("Failed to update Snapshot proposal:", error);

      let errorMessage = "Failed to update Snapshot proposal";
      if (error?.message?.includes("EDITOR_ROLE")) {
        errorMessage = "You need editor permissions to moderate Snapshot links";
      } else if (error?.message?.includes("QCIDoesNotExist")) {
        errorMessage = "QCI does not exist";
      } else if (error?.message?.includes("InvalidSnapshotID")) {
        errorMessage = "Invalid Snapshot ID provided";
      } else if (error?.message?.includes("user rejected")) {
        errorMessage = "Transaction cancelled by user";
      } else if (error?.message) {
        errorMessage = error.message;
      }

      setError(errorMessage);
      toast.error("Update failed", { description: errorMessage });
    } finally {
      setIsUpdating(false);
    }
  };

  if (!showForm) {
    return (
      <Button
        onClick={() => setShowForm(true)}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <Edit3 className="h-3 w-3" />
        Update Snapshot Link
      </Button>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Edit3 className="h-4 w-4" />
          Update Snapshot Proposal Link
        </CardTitle>
        <CardDescription>
          As an editor, you can update the Snapshot proposal link for moderation purposes.
          This action will be logged on-chain with your reason.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="current-proposal">Current Proposal ID</Label>
          <Input
            id="current-proposal"
            value={currentProposalId}
            disabled
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-proposal">New Proposal ID</Label>
          <Input
            id="new-proposal"
            placeholder="Enter new Snapshot proposal ID"
            value={newProposalId}
            onChange={(e) => setNewProposalId(e.target.value)}
            disabled={isUpdating}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Enter the full Snapshot proposal ID (e.g., 0x123abc...)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reason">
            Reason for Update <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="reason"
            placeholder="Explain why this proposal link needs to be updated..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isUpdating}
            rows={3}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground">
            This reason will be permanently recorded on-chain for transparency.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button
            onClick={() => {
              setShowForm(false);
              setNewProposalId("");
              setReason("");
              setError(null);
            }}
            variant="outline"
            disabled={isUpdating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={isUpdating || !newProposalId.trim() || !reason.trim()}
            className="gap-2"
          >
            {isUpdating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Update Proposal Link
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default SnapshotModerator;