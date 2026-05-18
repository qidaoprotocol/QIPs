import { useQuery } from '@tanstack/react-query';

export interface SnapshotProposal {
  id: string;
  title: string;
  state: 'pending' | 'active' | 'closed';
  author: string;
  created: number;
  start: number;
  end: number;
  snapshot: string;
  choices: string[];
  scores: number[];
  scores_total: number;
  votes: number;
  quorum: number;
  space: {
    id: string;
    name: string;
  };
  link?: string;
  discussion?: string;
}

const SNAPSHOT_GRAPHQL_URL = 'https://hub.snapshot.org/graphql';

// How long to wait before flushing a pending batch. Long enough for sibling
// component mounts in the same render tick to enqueue their ids, short enough
// to keep the UI feeling instant.
const BATCH_WINDOW_MS = 20;

// Safety cap. Snapshot's `first` allows up to 1000 but we stay well below to
// keep individual responses small.
const BATCH_MAX_SIZE = 100;

function extractProposalId(input: string | undefined | null): string | null {
  if (!input) return null;
  // Handle full URLs
  const urlMatch = input.match(/snapshot\.org\/.*\/(0x[a-fA-F0-9]+)/);
  if (urlMatch) return urlMatch[1];
  // Handle direct proposal IDs (0x format)
  if (input.startsWith('0x')) return input;
  // Handle ipfs:// URLs or other formats
  const ipfsMatch = input.match(/(0x[a-fA-F0-9]+)/);
  if (ipfsMatch) return ipfsMatch[1];
  return null;
}

// ─── Request coalescer ──────────────────────────────────────────────────────
//
// AllProposals renders one ProposalListItem per QCI, and each ProposalListItem
// renders a SnapshotStatus that calls useSnapshotProposal(id). Without
// coalescing this fires 40+ parallel GraphQL queries to hub.snapshot.org just
// to populate row badges. A coalescer at the fetch layer collapses all
// concurrent fetches into one `proposals(where: { id_in: [...] })` request,
// independent of how many React components fire useSnapshotProposal.
//
// React Query already dedups identical queryKeys to a single queryFn call
// per cache entry, so this coalescer sees one BatchEntry per unique id even
// when many components ask for the same proposal.

interface BatchEntry {
  id: string;
  resolve: (p: SnapshotProposal | null) => void;
  reject: (e: Error) => void;
}

let pending: BatchEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Exported so useQIPNumbers (and any future Snapshot caller in this codebase)
// can share the same coalescer rather than firing its own per-id fetches.
export function fetchSnapshotProposal(proposalId: string): Promise<SnapshotProposal | null> {
  return new Promise((resolve, reject) => {
    pending.push({ id: proposalId, resolve, reject });

    if (pending.length >= BATCH_MAX_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      // Schedule micro-task so the calling component finishes its render frame
      // before we fire the network request.
      void Promise.resolve().then(flushPending);
      return;
    }

    if (!flushTimer) {
      flushTimer = setTimeout(flushPending, BATCH_WINDOW_MS);
    }
  });
}

async function flushPending(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = pending;
  pending = [];
  if (batch.length === 0) return;

  // Dedup ids within the batch so we don't ask Snapshot for the same id twice.
  const uniqueIds = Array.from(new Set(batch.map((b) => b.id)));

  const query = `
    query Proposals($ids: [String]!) {
      proposals(where: { id_in: $ids }, first: ${uniqueIds.length}) {
        id
        title
        state
        author
        created
        start
        end
        snapshot
        choices
        scores
        scores_total
        votes
        quorum
        space {
          id
          name
        }
        link
        discussion
      }
    }
  `;

  try {
    const response = await fetch(SNAPSHOT_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { ids: uniqueIds } }),
    });

    if (!response.ok) {
      const err = new Error(`Snapshot HTTP ${response.status}`);
      for (const e of batch) e.reject(err);
      return;
    }

    const data = await response.json();

    if (data.errors) {
      console.error('[useSnapshotProposal] GraphQL errors:', data.errors);
      for (const e of batch) e.resolve(null);
      return;
    }

    const proposalsById = new Map<string, SnapshotProposal>();
    const proposals: SnapshotProposal[] = data.data?.proposals ?? [];
    for (const p of proposals) {
      if (p?.id) proposalsById.set(p.id.toLowerCase(), p);
    }

    for (const { id, resolve } of batch) {
      resolve(proposalsById.get(id.toLowerCase()) ?? null);
    }
  } catch (error) {
    console.error('[useSnapshotProposal] Batch fetch failed:', error);
    const err = error instanceof Error ? error : new Error(String(error));
    for (const e of batch) e.reject(err);
  }
}

export function useSnapshotProposal(proposalIdOrUrl: string | undefined | null) {
  const proposalId = extractProposalId(proposalIdOrUrl);

  return useQuery<SnapshotProposal | null>({
    queryKey: ['snapshot', 'proposal', proposalId],
    queryFn: () => proposalId ? fetchSnapshotProposal(proposalId) : Promise.resolve(null),
    enabled: !!proposalId,
    staleTime: 1000 * 60 * 5, // 5 minutes for active proposals
    gcTime: 1000 * 60 * 60, // 1 hour cache
    refetchInterval: (query) => {
      // Refetch active proposals every 5 minutes
      if (query.state.data?.state === 'active') {
        return 1000 * 60 * 5;
      }
      // Don't refetch closed/pending proposals
      return false;
    },
  });
}
