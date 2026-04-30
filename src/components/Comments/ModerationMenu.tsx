import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { config } from '@/config/env';
import { getMaiAPIClient } from '@/services/maiApiClient';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { queryKeyPatterns, queryKeys } from '@/utils/queryKeys';

interface ModerationMenuProps {
  qciId: number;
  commentId: number;
  isHidden: boolean;
  sessionToken?: string;
}

/**
 * Editor-only menu attached to each rendered comment. The visual gate (only
 * rendered when useIsEditor() returns true) is polish; the API enforces
 * authorization independently — the moderation routes call hasRole()
 * server-side before applying any change.
 *
 * Hide flow uses optimistic UI: the row is removed from the list cache as
 * soon as the user confirms, then we invalidate after the mutation resolves
 * to pick up the API's authoritative state. On error we re-invalidate so
 * the row reappears.
 */
export const ModerationMenu: React.FC<ModerationMenuProps> = ({
  qciId,
  commentId,
  isHidden,
  sessionToken,
}) => {
  const queryClient = useQueryClient();
  const client = getMaiAPIClient(config.maiApiUrl);
  const [hideDialogOpen, setHideDialogOpen] = useState(false);
  const [reason, setReason] = useState('');

  const hideMutation = useMutation({
    mutationFn: async () => {
      const result = await client.hideQipComment({
        commentId,
        reason: reason.trim() || undefined,
        sessionToken,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.qipComments(qciId) });
      const previous = queryClient.getQueryData(queryKeys.qipComments(qciId));
      // Optimistically remove the row from every loaded page.
      queryClient.setQueryData(
        queryKeys.qipComments(qciId),
        (old: { pages?: Array<{ comments: Array<{ id: number }> }> } | undefined) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              comments: page.comments.filter((c) => c.id !== commentId),
            })),
          };
        },
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.qipComments(qciId), ctx.previous);
      }
      toast.error(`Failed to hide comment: ${err instanceof Error ? err.message : 'unknown'}`);
    },
    onSuccess: () => {
      toast.success('Comment hidden');
      setHideDialogOpen(false);
      setReason('');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeyPatterns.allQipComments });
    },
  });

  const unhideMutation = useMutation({
    mutationFn: async () => {
      const result = await client.unhideQipComment({ commentId, sessionToken });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result;
    },
    onSuccess: () => {
      toast.success('Comment restored');
    },
    onError: (err) => {
      toast.error(`Failed to unhide comment: ${err instanceof Error ? err.message : 'unknown'}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeyPatterns.allQipComments });
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label="Moderation menu"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isHidden ? (
            <DropdownMenuItem
              onSelect={() => unhideMutation.mutate()}
              disabled={unhideMutation.isPending}
            >
              Restore comment
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setHideDialogOpen(true)}>
              Hide comment
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={hideDialogOpen} onOpenChange={setHideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hide this comment?</DialogTitle>
            <DialogDescription>
              The comment is removed from the public view but kept in the audit log. You can
              restore it from the same menu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="hide-reason" className="text-sm text-muted-foreground">
              Reason (optional)
            </label>
            <Input
              id="hide-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Spam, off-topic, ..."
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setHideDialogOpen(false);
                setReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => hideMutation.mutate()}
              disabled={hideMutation.isPending}
            >
              {hideMutation.isPending ? 'Hiding...' : 'Hide'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
