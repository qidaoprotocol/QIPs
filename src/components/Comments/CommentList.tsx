import React, { useEffect, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useComments } from '@/hooks/useComments';
import { useIsEditor } from '@/hooks/useIsEditor';
import { useSiweSession } from '@/hooks/useSiweSession';
import type { Comment } from '@/types/comments';
import { Skeleton } from './CommentSkeleton';
import { SafeMarkdown } from './SafeMarkdown';
import { ModerationMenu } from './ModerationMenu';

interface CommentListProps {
  qciId: number;
}

const SHORTEN_LEAD = 6;
const SHORTEN_TAIL = 4;

function shortenAddress(addr: string): string {
  if (!addr.startsWith('0x') || addr.length < SHORTEN_LEAD + SHORTEN_TAIL + 2) return addr;
  return `${addr.slice(0, SHORTEN_LEAD)}…${addr.slice(-SHORTEN_TAIL)}`;
}

export const CommentList: React.FC<CommentListProps> = ({ qciId }) => {
  const { comments, isLoading, isError, hasMore, isFetchingMore, fetchMore } = useComments(qciId);
  const { isEditor } = useIsEditor();
  const { sessionToken } = useSiweSession();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Infinite scroll: when the sentinel below the last row enters the viewport,
  // ask the query for the next page. We disable the observer while a fetch
  // is already in flight so we don't queue duplicate page requests.
  useEffect(() => {
    if (!hasMore || isFetchingMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) fetchMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isFetchingMore, fetchMore]);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Couldn't load comments. Try refreshing the page.
      </p>
    );
  }

  if (comments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No comments yet. Voters with sufficient aveQi can post.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {comments.map((c) => (
        <CommentRow
          key={c.id}
          comment={c}
          qciId={qciId}
          showModeration={isEditor}
          sessionToken={sessionToken}
        />
      ))}

      {/* Sentinel for infinite-scroll. */}
      {hasMore && <div ref={sentinelRef} aria-hidden="true" />}

      {isFetchingMore && (
        <div className="text-center text-sm text-muted-foreground">Loading more…</div>
      )}
    </div>
  );
};

interface CommentRowProps {
  comment: Comment;
  qciId: number;
  showModeration: boolean;
  sessionToken?: string;
}

const CommentRow: React.FC<CommentRowProps> = ({
  comment,
  qciId,
  showModeration,
  sessionToken,
}) => {
  const display = comment.ensName ?? shortenAddress(comment.author);
  const timestamp = formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true });

  return (
    <div className="flex gap-3 border-b border-border/40 pb-6 last:border-0">
      <div
        className="h-8 w-8 shrink-0 rounded-full bg-muted"
        aria-hidden="true"
        // Trivial deterministic-color placeholder. Real avatar render (Boring
        // Avatars / blockies) is a follow-up; keeping it minimal here so we
        // don't pull a new dependency just for this PR.
        style={{ background: `hsl(${hashHue(comment.author)} 60% 45%)` }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-foreground">{display}</span>
          <span className="text-xs text-muted-foreground">{timestamp}</span>
          {showModeration && (
            <div className="ml-auto">
              <ModerationMenu
                qciId={qciId}
                commentId={comment.id}
                isHidden={Boolean(comment.hiddenAt)}
                sessionToken={sessionToken}
              />
            </div>
          )}
        </div>
        <SafeMarkdown body={comment.body} className="prose prose-sm dark:prose-invert mt-1 max-w-none" />
      </div>
    </div>
  );
};

function hashHue(addr: string): number {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}
