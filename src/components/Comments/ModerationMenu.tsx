import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { config } from '@/config/env';
import { useComments } from '@/hooks/useComments';
import { useSiweSession } from '@/hooks/useSiweSession';
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
  /** Lowercased 0x-prefixed comment author address. */
  commentAuthor: string;
  isHidden: boolean;
  /** Lowercased current SIWE-session address, or undefined when no session. */
  viewerAddress?: string;
  /** Editor takes precedence over owner mode when both are true. */
  isEditor: boolean;
  sessionToken?: string;
}

type MenuMode = 'editor' | 'owner' | 'none';

function pickMode(args: {
  isEditor: boolean;
  viewerAddress?: string;
  commentAuthor: string;
  isHidden: boolean;
}): MenuMode {
  if (args.isEditor) return 'editor';
  if (
    args.viewerAddress &&
    !args.isHidden &&
    args.viewerAddress.toLowerCase() === args.commentAuthor.toLowerCase()
  ) {
    return 'owner';
  }
  return 'none';
}

/**
 * Per-row menu attached to each rendered comment. Two display modes:
 *
 *   - editor: hide / restore (existing flow). Visible whenever the viewer
 *     has EDITOR_ROLE on the QCIRegistry. Server enforces hasRole() again,
 *     independent of this UI gate.
 *   - owner:  delete-own (new flow). Visible when the viewer is NOT an
 *     editor, IS the comment's author, and the comment is currently visible.
 *     Server enforces author == session.address again as a SQL predicate.
 *
 * Editor takes precedence — an editor reading their own comment uses the
 * hide flow, mirroring how every comment platform handles overlap.
 */
export const ModerationMenu: React.FC<ModerationMenuProps> = ({
  qciId,
  commentId,
  commentAuthor,
  isHidden,
  viewerAddress,
  isEditor,
  sessionToken,
}) => {
  const queryClient = useQueryClient();
  const client = getMaiAPIClient(config.maiApiUrl);
  const { deleteComment, isDeleting } = useComments(qciId);
  const { clearOn401 } = useSiweSession();
  const [hideDialogOpen, setHideDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reason, setReason] = useState('');

  const mode = pickMode({ isEditor, viewerAddress, commentAuthor, isHidden });

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

  const handleConfirmDelete = async () => {
    setDeleteDialogOpen(false);
    const result = await deleteComment({ commentId, sessionToken });
    if (result.ok) {
      toast.success('Comment deleted');
      return;
    }
    switch (result.status) {
      case 401:
        clearOn401();
        toast.error('Your session expired. Please sign in again.');
        break;
      case 403:
        // Defensive — UI should never expose Delete on a non-owned row.
        toast.error('You can only delete your own comments.');
        break;
      case 404:
        toast.error('Comment not found.');
        break;
      case 409:
        toast.error('This comment is already hidden.');
        break;
      default:
        toast.error(`Couldn't delete: ${result.error}`);
    }
  };

  if (mode === 'none') return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={mode === 'owner' ? 'Comment actions' : 'Moderation menu'}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {mode === 'editor' && isHidden && (
            <DropdownMenuItem
              onSelect={() => unhideMutation.mutate()}
              disabled={unhideMutation.isPending}
            >
              Restore comment
            </DropdownMenuItem>
          )}
          {mode === 'editor' && !isHidden && (
            <DropdownMenuItem onSelect={() => setHideDialogOpen(true)}>
              Hide comment
            </DropdownMenuItem>
          )}
          {mode === 'owner' && (
            <DropdownMenuItem
              onSelect={() => setDeleteDialogOpen(true)}
              disabled={isDeleting}
              className="text-destructive focus:text-destructive"
            >
              Delete
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

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this comment?</DialogTitle>
            <DialogDescription>
              This can't be undone. The comment is removed from the public view immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
