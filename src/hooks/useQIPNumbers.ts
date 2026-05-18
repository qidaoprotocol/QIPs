import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { SnapshotProposal } from './useSnapshotProposal';

const SNAPSHOT_GRAPHQL_URL = 'https://hub.snapshot.org/graphql';

// Snapshot's GraphQL `first` cap is 1000; stay well below to keep payloads small.
const BATCH_SIZE = 100;

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

// Snapshot returns IDs lowercased; the IDs we receive from QCI proposal URLs
// may be any case. Normalize on both sides of the lookup to avoid mismatches.
async function fetchProposalTitles(ids: string[]): Promise<Record<string, string>> {
  const titleById: Record<string, string> = {};

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const query = `
      query Proposals($ids: [String]!) {
        proposals(where: { id_in: $ids }, first: ${chunk.length}) {
          id
          title
        }
      }
    `;

    try {
      const response = await fetch(SNAPSHOT_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { ids: chunk } }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (data.errors) {
        console.error('[useQIPNumbers] Snapshot GraphQL errors:', data.errors);
        continue;
      }

      const proposals: Array<{ id?: string; title?: string }> = data.data?.proposals ?? [];
      for (const p of proposals) {
        if (p?.id && typeof p.title === 'string') {
          titleById[p.id.toLowerCase()] = p.title;
        }
      }
    } catch (error) {
      console.error('[useQIPNumbers] Snapshot batch fetch failed:', error);
    }
  }

  return titleById;
}

/**
 * Hook to efficiently fetch QIP numbers for multiple proposals.
 *
 * Issues a single batched Snapshot GraphQL query (chunked by BATCH_SIZE) for
 * all proposal IDs instead of one request per proposal. Result is cached for
 * 1h since QIP numbers don't change after a proposal is posted.
 *
 * If `useSnapshotProposal` has already populated the full proposal under
 * ['snapshot','proposal', id] for any individual proposal, that data is
 * preferred over the batched title-only result.
 */
export function useQIPNumbers(proposals: Array<{ proposal?: string; qciNumber: number }>): Map<number, number | null> {
  const proposalUrls = useMemo(() => {
    return proposals
      .filter(p => p.proposal && p.proposal !== 'None' && p.proposal !== 'TBU' && p.proposal !== 'none' && p.proposal !== 'tbu')
      .map(p => ({ url: p.proposal!, qciNumber: p.qciNumber }));
  }, [proposals]);

  // Sorted, deduped, lowercased list of proposal IDs to query. Sorting keeps
  // the React Query queryKey stable across renders where the input order
  // shifts.
  const proposalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { url } of proposalUrls) {
      const id = extractProposalId(url);
      if (id) ids.add(id.toLowerCase());
    }
    return Array.from(ids).sort();
  }, [proposalUrls]);

  const queryClient = useQueryClient();

  // Single batched query for all titles. Result is a Record<id, title>.
  const titlesQuery = useQuery<Record<string, string>>({
    queryKey: ['snapshot', 'qip-titles', proposalIds],
    queryFn: () => fetchProposalTitles(proposalIds),
    enabled: proposalIds.length > 0,
    staleTime: 1000 * 60 * 60, // 1 hour - QIP numbers don't change
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });

  const qipNumberMap = useMemo(() => {
    const map = new Map<number, number | null>();
    const batchedTitles = titlesQuery.data ?? {};

    proposalUrls.forEach(({ qciNumber, url }) => {
      const rawId = extractProposalId(url);
      if (!rawId) {
        map.set(qciNumber, null);
        return;
      }

      // Prefer full proposal data from useSnapshotProposal cache when present;
      // fall back to the batched titles map.
      const full = queryClient.getQueryData<SnapshotProposal>(['snapshot', 'proposal', rawId]);
      const title = full?.title ?? batchedTitles[rawId.toLowerCase()];
      map.set(qciNumber, title ? extractQipNumber(title) : null);
    });

    return map;
  }, [proposalUrls, queryClient, titlesQuery.data]);

  return qipNumberMap;
}
