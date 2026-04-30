import React from 'react';
import { CommentComposer } from './CommentComposer';
import { CommentList } from './CommentList';
import { SiweLoginButton } from './SiweLoginButton';
import { useSiweSession } from '@/hooks/useSiweSession';

interface CommentsProps {
  qciId: number;
}

/**
 * Top-level comment surface for a QIP detail page.
 *
 * Read path is unconditional — the comment list renders even without a
 * connected wallet. Write path is gated by SIWE: if the user has no session,
 * SiweLoginButton handles connect + sign-in; once authenticated, the
 * composer takes over.
 *
 * Caller should mount this with a qciId-keyed parent (or trust the natural
 * unmount/mount when the route's qciId param changes) so navigating between
 * QCIs resets the comment tree cleanly.
 */
export const Comments: React.FC<CommentsProps> = ({ qciId }) => {
  const { sessionToken } = useSiweSession();

  return (
    <section
      aria-label="Comments"
      className="mt-8 border-t border-border pt-6"
      key={qciId}
    >
      <h2 className="mb-4 text-lg font-semibold text-foreground">Discussion</h2>

      <CommentList qciId={qciId} />

      <div className="mt-6">
        {sessionToken ? <CommentComposer qciId={qciId} /> : <SiweLoginButton />}
      </div>
    </section>
  );
};

export default Comments;
