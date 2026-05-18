import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchSnapshotProposal, type SnapshotProposal } from './useSnapshotProposal';

/**
 * Extract QIP number from proposal title
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
 * Extract proposal ID from URL or ID string
 */
function extractProposalId(input: string): string | null {
  const urlMatch = input.match(/snapshot\.org\/.*\/(0x[a-fA-F0-9]+)/);
  if (urlMatch) return urlMatch[1];
  if (input.startsWith('0x')) return input;
  const ipfsMatch = input.match(/(0x[a-fA-F0-9]+)/);
  if (ipfsMatch) return ipfsMatch[1];
  return null;
}

export interface QCIWithQIPNumber {
  qciNumber: number;
  qipNumber: number | null;
  snapshotProposalId: string | null;
}

/**
 * Hook to derive a qciNumber -> qipNumber map from Snapshot proposal titles.
 *
 * Uses `useQueries` with the same ['snapshot', 'proposal', id] cache key that
 * useSnapshotProposal uses, so React Query dedups them at the cache layer and
 * the actual fetch goes through useSnapshotProposal's request coalescer —
 * meaning the 40+ row-level SnapshotStatus components and this hook together
 * fire a single batched `proposals(where: { id_in: [...] })` GraphQL request
 * instead of one per proposal.
 */
export function useQIPNumbers(proposals: Array<{ proposal?: string; qciNumber: number }>): Map<number, number | null> {
  const proposalUrls = useMemo(() => {
    return proposals
      .filter(p => p.proposal && p.proposal !== 'None' && p.proposal !== 'TBU' && p.proposal !== 'none' && p.proposal !== 'tbu')
      .map(p => ({ url: p.proposal!, qciNumber: p.qciNumber }));
  }, [proposals]);

  const queries = useQueries({
    queries: proposalUrls.map(({ url }) => {
      const proposalId = extractProposalId(url);
      return {
        queryKey: ['snapshot', 'proposal', proposalId],
        queryFn: () => proposalId ? fetchSnapshotProposal(proposalId) : Promise.resolve(null),
        staleTime: 1000 * 60 * 60, // 1 hour
        gcTime: 1000 * 60 * 60 * 24, // 24 hours
        enabled: !!proposalId,
      };
    }),
  });

  const queryClient = useQueryClient();

  const qipNumberMap = useMemo(() => {
    const map = new Map<number, number | null>();
    proposalUrls.forEach(({ qciNumber, url }) => {
      const proposalId = extractProposalId(url);
      if (!proposalId) {
        map.set(qciNumber, null);
        return;
      }
      const cached = queryClient.getQueryData<SnapshotProposal>(['snapshot', 'proposal', proposalId]);
      map.set(qciNumber, cached?.title ? extractQipNumber(cached.title) : null);
    });
    return map;
  }, [proposalUrls, queryClient, queries]);

  return qipNumberMap;
}
