import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { SnapshotProposal } from './useSnapshotProposal';

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
 * Hook to efficiently fetch QIP numbers for multiple proposals
 * Uses React Query's useQueries to batch fetch in parallel
 */
export function useQIPNumbers(proposals: Array<{ proposal?: string; qciNumber: number }>): Map<number, number | null> {
  // Extract unique proposal URLs - memoize to prevent re-creating queries
  const proposalUrls = useMemo(() => {
    return proposals
      .filter(p => p.proposal && p.proposal !== 'None' && p.proposal !== 'TBU' && p.proposal !== 'none' && p.proposal !== 'tbu')
      .map(p => ({ url: p.proposal!, qciNumber: p.qciNumber }));
  }, [proposals]);

  // Create a query for each proposal
  const queries = useQueries({
    queries: proposalUrls.map(({ url, qciNumber }) => {
      const proposalId = extractProposalId(url);

      return {
        queryKey: ['snapshot', 'proposal', proposalId],
        queryFn: async () => {
          if (!proposalId) {
            return { qciNumber, qipNumber: null };
          }

          const query = `
            query Proposal($id: String!) {
              proposal(id: $id) {
                id
                title
              }
            }
          `;

          try {
            const response = await fetch('https://hub.snapshot.org/graphql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query, variables: { id: proposalId } }),
            });

            if (!response.ok) {
              return { qciNumber, qipNumber: null };
            }

            const data = await response.json();

            if (data.errors) {
              return { qciNumber, qipNumber: null };
            }

            const title = data.data?.proposal?.title;
            const qipNumber = title ? extractQipNumber(title) : null;

            return { qciNumber, qipNumber };
          } catch (error) {
            console.error(`Error fetching QIP number for QCI ${qciNumber}:`, error);
            return { qciNumber, qipNumber: null };
          }
        },
        staleTime: 1000 * 60 * 60, // 1 hour - QIP numbers don't change
        gcTime: 1000 * 60 * 60 * 24, // 24 hours cache
        enabled: !!proposalId,
      };
    }),
  });

  // Access query client to read existing cached data
  const queryClient = useQueryClient();

  // Build a map of QCI number to QIP number
  // Check both our queries AND the existing cache from useSnapshotProposal
  const qipNumberMap = useMemo(() => {
    const map = new Map<number, number | null>();

    proposalUrls.forEach(({ qciNumber, url }) => {
      const proposalId = extractProposalId(url);
      if (!proposalId) {
        map.set(qciNumber, null);
        return;
      }

      // Check if data exists in cache (from ProposalListItem's useSnapshotProposal)
      const cachedData = queryClient.getQueryData<SnapshotProposal>(['snapshot', 'proposal', proposalId]);

      if (cachedData?.title) {
        const qipNumber = extractQipNumber(cachedData.title);
        map.set(qciNumber, qipNumber);
      } else {
        // Data not yet loaded, will remain null until queries complete
        map.set(qciNumber, null);
      }
    });

    return map;
  }, [proposalUrls, queryClient, queries]);

  return qipNumberMap;
}
