import { useSnapshotProposal } from './useSnapshotProposal';

/**
 * Extract QIP number from proposal title
 * Handles various formats including voice-to-text errors
 */
function extractQipNumber(title: string): number | null {
  const patterns = [
    /(?:QIP|qip)[-\s#]*(\d+)[:]/i, // Main pattern with colon
    /(?:QIP|qip)[-\s#]*(\d+)\b/i, // Without colon
    /^(\d+)[:.-]\s*/, // Starting with just number
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > 0 && num < 10000) {
        return num;
      }
    }
  }
  return null;
}

/**
 * Hook to get QIP number from a Snapshot proposal ID or URL
 * Returns null if no Snapshot proposal or if QIP number can't be extracted
 */
export function useQIPNumber(snapshotProposalIdOrUrl: string | undefined | null) {
  const { data: proposal, isLoading } = useSnapshotProposal(snapshotProposalIdOrUrl);

  const qipNumber = proposal?.title ? extractQipNumber(proposal.title) : null;

  return {
    qipNumber,
    isLoading,
    hasSnapshot: !!snapshotProposalIdOrUrl && snapshotProposalIdOrUrl !== 'None' && snapshotProposalIdOrUrl !== 'TBU',
  };
}
