import React from 'react';
import { useSnapshotProposal } from '../hooks/useSnapshotProposal';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Users, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SnapshotStatusProps {
  proposalIdOrUrl: string | undefined | null;
  showVotes?: boolean;
  compact?: boolean;
  className?: string;
}

export const SnapshotStatus: React.FC<SnapshotStatusProps> = ({
  proposalIdOrUrl,
  showVotes = true,
  compact = false,
  className
}) => {
  const { data: proposal, isLoading, error } = useSnapshotProposal(proposalIdOrUrl);

  if (!proposalIdOrUrl || proposalIdOrUrl === 'None' || proposalIdOrUrl === 'TBU') {
    return null;
  }

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="animate-pulse">
          <div className="h-5 w-20 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !proposal || !proposal.space) {
    return null;
  }

  const getStatusBadgeVariant = (state: string) => {
    switch (state) {
      case 'active':
        return 'default';
      case 'closed':
        return 'secondary';
      case 'pending':
        return 'outline';
      default:
        return 'outline';
    }
  };

  const getStatusIcon = (state: string) => {
    switch (state) {
      case 'active':
        return <Clock className="h-3 w-3" />;
      case 'closed':
        return <CheckCircle className="h-3 w-3" />;
      case 'pending':
        return <AlertCircle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toFixed(0);
  };

  const getWinningChoice = () => {
    if (!proposal.scores || proposal.scores.length === 0) return null;
    const maxScore = Math.max(...proposal.scores);
    const winningIndex = proposal.scores.indexOf(maxScore);
    return proposal.choices[winningIndex];
  };

  const formatChoiceForDisplay = (choice: string) => {
    // Handle exact matches first
    const exactMatches: Record<string, string> = {
      'For': 'Approved',
      'Against': 'Rejected',
      'Yes': 'Yes',
      'No': 'No',
      'Abstain': 'Abstained',
      'Further discussions needed': 'Needs Discussion',
    };

    if (exactMatches[choice]) {
      return exactMatches[choice];
    }

    // Handle substrings
    const lowerChoice = choice.toLowerCase();
    if (lowerChoice.includes('approve')) {
      return 'Approved';
    }
    if (lowerChoice.includes('reject')) {
      return 'Rejected';
    }
    if (lowerChoice.includes('discussion')) {
      return 'Needs Discussion';
    }

    // Return original if no match
    return choice;
  };

  const getVotePercentage = (index: number) => {
    if (!proposal.scores_total || proposal.scores_total === 0) return 0;
    return ((proposal.scores[index] / proposal.scores_total) * 100).toFixed(1);
  };

  const snapshotUrl = `https://snapshot.org/#/${proposal.space.id}/proposal/${proposal.id}`;

  if (compact) {
    // For closed proposals, show the winning choice instead of "Closed"
    if (proposal.state === 'closed') {
      const winner = getWinningChoice();
      if (winner) {
        return (
          <Badge variant="secondary" className={cn("gap-1", className)}>
            <CheckCircle className="h-3 w-3" />
            <span>{formatChoiceForDisplay(winner)}</span>
          </Badge>
        );
      }
    }

    // For active and pending proposals, show the state
    return (
      <Badge variant={getStatusBadgeVariant(proposal.state)} className={cn("gap-1", className)}>
        {getStatusIcon(proposal.state)}
        <span className="capitalize">{proposal.state}</span>
      </Badge>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <Badge variant={getStatusBadgeVariant(proposal.state)} className="gap-1">
          {getStatusIcon(proposal.state)}
          <span className="capitalize">{proposal.state}</span>
        </Badge>

        <a
          href={snapshotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
        >
          View on Snapshot
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {showVotes && proposal.scores && proposal.scores.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{proposal.votes} votes • {formatNumber(proposal.scores_total)} voting power</span>
          </div>

          <div className="space-y-1">
            {proposal.choices.map((choice, index) => {
              const percentage = getVotePercentage(index);
              const isWinning = proposal.state === 'closed' && choice === getWinningChoice();

              return (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className={cn(
                      "font-medium",
                      isWinning && "text-green-600 dark:text-green-500"
                    )}>
                      {choice}
                      {isWinning && " ✓"}
                    </span>
                    <span className="text-muted-foreground">
                      {percentage}% ({formatNumber(proposal.scores[index])})
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className={cn(
                        "h-2 rounded-full transition-all",
                        isWinning ? "bg-green-500" : "bg-primary"
                      )}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {proposal.state === 'active' && (
        <div className="text-xs text-muted-foreground">
          Voting ends {new Date(proposal.end * 1000).toLocaleDateString()}
        </div>
      )}
    </div>
  );
};