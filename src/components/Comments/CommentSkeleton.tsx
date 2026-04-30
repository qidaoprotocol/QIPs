import React from 'react';

/** Minimal skeleton row used while a comment list is loading. */
export const Skeleton: React.FC = () => (
  <div className="flex gap-3 border-b border-border/40 pb-6 last:border-0">
    <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
    <div className="flex-1 space-y-2">
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="h-3 w-full animate-pulse rounded bg-muted" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
    </div>
  </div>
);
