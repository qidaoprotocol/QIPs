import React, { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { QCIStatus } from '../services/qciClient';
import { useAllStatuses } from '../hooks/useAllStatuses';
import { useStatusUpdateMutation } from '../hooks/useStatusUpdateMutation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface InlineStatusEditorProps {
  qciNumber: number;
  currentStatus: string;
  currentStatusEnum?: QCIStatus;
  isAuthor: boolean;
  isEditor: boolean;
  onStatusUpdate?: () => void;
  registryAddress: `0x${string}`;
  rpcUrl?: string;
}

const statusStyles = {
  Draft: "bg-gray-100 text-gray-800 hover:bg-gray-200",
  "Ready for Snapshot": "bg-yellow-100 text-yellow-800 hover:bg-yellow-200",
  "Posted to Snapshot": "bg-green-100 text-green-800 hover:bg-green-200",
  Archived: "bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 dark:bg-gray-600/30 dark:text-gray-300",
  Implemented: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const InlineStatusEditor: React.FC<InlineStatusEditorProps> = ({
  qciNumber,
  currentStatus,
  currentStatusEnum,
  isAuthor,
  isEditor,
  onStatusUpdate,
  registryAddress,
  rpcUrl,
}) => {
  const statusUpdateMutation = useStatusUpdateMutation();
  const [isOpen, setIsOpen] = useState(false);

  // Use the cached status query
  const { data: availableStatuses = [], isLoading: statusesLoading } = useAllStatuses({
    registryAddress,
    rpcUrl,
  });

  const canEdit = isAuthor || isEditor;

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === currentStatus) {
      setIsOpen(false);
      return;
    }

    // Close dropdown immediately for better UX
    setIsOpen(false);

    // Execute the mutation
    try {
      await statusUpdateMutation.mutateAsync({
        qciNumber: BigInt(qciNumber),
        newStatus,
        registryAddress,
        rpcUrl,
      });

      // Trigger refresh callback if provided
      if (onStatusUpdate) {
        onStatusUpdate();
      }
    } catch (error) {
      console.error("Status update failed:", error);
    }
  };

  if (!canEdit) {
    return (
      <span
        className={cn(
          "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
          statusStyles[currentStatus as keyof typeof statusStyles] || "bg-gray-100 text-gray-800"
        )}
      >
        {currentStatus}
      </span>
    );
  }

  // Filter out current status and apply permission restrictions
  const otherStatuses = availableStatuses.filter((s) => {
    if (s.name === currentStatus) return false;
    if (isAuthor && !isEditor && s.name === "Posted to Snapshot") return false;
    if (isAuthor && !isEditor && currentStatus === "Archived") return false;
    return true;
  });

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-auto py-0.5 px-2.5 font-medium text-xs",
            statusStyles[currentStatus as keyof typeof statusStyles] || "bg-gray-100 text-gray-800",
            (statusUpdateMutation.isPending || statusesLoading) && "opacity-50 cursor-not-allowed"
          )}
          disabled={statusUpdateMutation.isPending || statusesLoading}
        >
          {statusUpdateMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          {currentStatus}
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {statusesLoading ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Loading statuses...
          </div>
        ) : otherStatuses.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No other statuses available</div>
        ) : (
          <>
            {isAuthor && !isEditor && currentStatus === "Ready for Snapshot" && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground border-b mb-1">Use "Submit to Snapshot" to post</div>
            )}
            {isAuthor && !isEditor && currentStatus === "Archived" && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground border-b mb-1">Only editors can unarchive</div>
            )}
            {otherStatuses.map((status) => (
              <DropdownMenuItem key={status.hash} onClick={() => handleStatusChange(status.name)} className="cursor-pointer">
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mr-2",
                    statusStyles[status.name as keyof typeof statusStyles] || "bg-gray-100 text-gray-800"
                  )}
                >
                  {status.name}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default InlineStatusEditor;