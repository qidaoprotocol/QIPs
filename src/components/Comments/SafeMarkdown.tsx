import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ALLOWED_PROTOCOLS = /^(https?:|mailto:)/i;

/**
 * Renders a comment body. Inputs are untrusted user-generated markdown — even
 * comments from high-VP wallets are UGC. Defenses, in layers:
 *
 *   1. react-markdown 10 disables raw HTML by default. We do not pass
 *      `rehype-raw` or any equivalent, so `<img onerror=...>` and the like
 *      come through as plain text.
 *
 *   2. urlTransform restricts link/image URL protocols to http(s) and
 *      mailto. Anything else (`javascript:`, `data:`, `ipfs:`, `vbscript:`,
 *      etc.) returns undefined, which makes react-markdown render the link
 *      text as plain text — there is no <a> element produced.
 *
 *   3. The custom <a> renderer always emits `target="_blank"` and
 *      `rel="noopener noreferrer nofollow"` so even allow-listed protocols
 *      cannot perform tab-nabbing or pass referrer credit.
 *
 *   4. The custom <img> renderer returns null. Inline images would let an
 *      attacker beacon to arbitrary servers via redirect chains starting
 *      from an http(s) URL the protocol allowlist accepts. Stripping them
 *      is simpler than verifying every redirect target.
 */
const COMPONENTS: Components = {
  a({ href, children, ...rest }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        {...rest}
      >
        {children}
      </a>
    );
  },
  // Strip images entirely.
  img() {
    return null;
  },
};

interface SafeMarkdownProps {
  body: string;
  className?: string;
}

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ body, className }) => {
  return (
    <div className={className ?? 'prose prose-sm dark:prose-invert max-w-none'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (ALLOWED_PROTOCOLS.test(url) ? url : '')}
        components={COMPONENTS}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
};
