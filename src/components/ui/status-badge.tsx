import React from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { QCIStatus, DEFAULT_STATUSES } from '@/services/qciClient';

export type StatusType = QCIStatus | 'Draft' | 'Ready for Snapshot' | 'Posted to Snapshot' | 'Archived' | 'Implemented';

interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: StatusType | string;
  statusName?: string; // Optional: if status name is already fetched
  size?: 'sm' | 'default' | 'lg';
}

const STATUS_CONFIG: Record<number | string, { label: string; className: string }> = {
  // New simplified status system (numbers)
  [DEFAULT_STATUSES.Draft]: {
    label: "Draft",
    className: "bg-muted text-foreground hover:bg-muted/80",
  },
  [DEFAULT_STATUSES.ReadyForSnapshot]: {
    label: "Ready for Snapshot",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25",
  },
  [DEFAULT_STATUSES.PostedToSnapshot]: {
    label: "Posted to Snapshot",
    className: "bg-primary/10 text-primary hover:bg-primary/20",
  },
  [DEFAULT_STATUSES.Archived]: {
    label: "Archived",
    className: "bg-gray-500/20 text-gray-600 dark:text-gray-300 hover:bg-gray-500/30 dark:bg-gray-600/30 dark:hover:bg-gray-600/40",
  },
  // Implemented status (enum value 4)
  4: {
    label: "Implemented",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25",
  },
  // String values for custom statuses
  Draft: {
    label: "Draft",
    className: "bg-muted text-foreground hover:bg-muted/80",
  },
  "Ready for Snapshot": {
    label: "Ready for Snapshot",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25",
  },
  "Posted to Snapshot": {
    label: "Posted to Snapshot",
    className: "bg-primary/10 text-primary hover:bg-primary/20",
  },
  Archived: {
    label: "Archived",
    className: "bg-gray-500/20 text-gray-600 dark:text-gray-300 hover:bg-gray-500/30 dark:bg-gray-600/30 dark:hover:bg-gray-600/40",
  },
  Implemented: {
    label: "Implemented",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25",
  },
};

const SIZE_CLASSES = {
  sm: 'text-xs px-2 py-0.5',
  default: 'text-sm px-2.5 py-0.5',
  lg: 'text-base px-3 py-1',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  statusName,
  size = 'default',
  className,
  ...props
}) => {
  // If statusName is provided, use it; otherwise look up in config
  const label = statusName || STATUS_CONFIG[status]?.label || STATUS_CONFIG[String(status)]?.label || `Status ${status}`;
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[String(status)] || {
    label: label,
    className: 'bg-muted text-foreground',
  };

  return (
    <Badge
      className={cn(
        'font-medium border-0',
        config.className,
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {statusName || config.label}
    </Badge>
  );
};

export const getStatusColor = (status: StatusType | string): string => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[String(status)];
  return config?.className || 'bg-muted text-foreground';
};

export const getStatusLabel = (status: StatusType | string, statusName?: string): string => {
  if (statusName) return statusName;
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[String(status)];
  return config?.label || String(status);
};