import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { config } from '@/config/env';
import { useComments } from '@/hooks/useComments';
import { useSiweSession } from '@/hooks/useSiweSession';

interface CommentComposerProps {
  qciId: number;
}

const WARNING_RATIO = 0.8;

const ENCODER = new TextEncoder();
function utf8ByteLength(s: string): number {
  return ENCODER.encode(s).length;
}

function formatNumber(s: string): string {
  // The API returns vp/threshold as decimal strings; render with thousand
  // separators when the integer part is large, leave the fractional part
  // untouched.
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const [intPart, fracPart] = s.split('.');
  const formatted = Number(intPart).toLocaleString();
  return fracPart ? `${formatted}.${fracPart}` : formatted;
}

/**
 * Gated comment composer. Lives below CommentList; only renders when the
 * caller has confirmed the user has an authenticated session — see
 * <Comments> for the wiring.
 */
export const CommentComposer: React.FC<CommentComposerProps> = ({ qciId }) => {
  const [body, setBody] = useState('');
  const { postComment, isPosting } = useComments(qciId);
  const { sessionToken, clearOn401 } = useSiweSession();

  const maxBytes = config.qipCommentsBodyMaxBytes;
  const byteLength = useMemo(() => utf8ByteLength(body), [body]);
  const overLimit = byteLength > maxBytes;
  const nearLimit = !overLimit && byteLength >= Math.floor(maxBytes * WARNING_RATIO);
  const trimmedEmpty = body.trim().length === 0;
  const submitDisabled = isPosting || trimmedEmpty || overLimit;

  const handleSubmit = async () => {
    if (submitDisabled) return;

    const result = await postComment({ body, sessionToken });

    if (result.ok) {
      setBody('');
      toast.success('Comment posted.');
      return;
    }

    // Failure paths — keep the textarea so the user can edit and retry.
    switch (result.status) {
      case 401:
        clearOn401();
        toast.error('Your session expired. Please sign in again.');
        break;
      case 403:
        toast.error(
          `You need ${formatNumber(result.threshold)} qipowah to comment. ` +
            `You have ${formatNumber(result.currentVp)}.`,
        );
        break;
      case 413:
        toast.error(`Comment too long. Maximum is ${result.maxBytes.toLocaleString()} bytes.`);
        break;
      case 429:
        toast.error("You're posting too fast. Please try again in a minute.");
        break;
      case 503:
        toast.error('Vote-power service is unavailable right now. Please try again shortly.');
        break;
      default:
        toast.error(`Couldn't post comment: ${result.error}`);
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Share your thoughts on this proposal…"
        rows={4}
        className="min-h-[100px]"
        disabled={isPosting}
      />
      <div className="flex items-center justify-between text-xs">
        <span
          className={
            overLimit
              ? 'text-destructive'
              : nearLimit
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
          }
          aria-live="polite"
        >
          {byteLength.toLocaleString()} / {maxBytes.toLocaleString()} bytes
          {overLimit && ' — too long'}
        </span>
        <Button onClick={handleSubmit} disabled={submitDisabled} size="sm">
          {isPosting ? 'Posting…' : 'Post'}
        </Button>
      </div>
    </div>
  );
};
