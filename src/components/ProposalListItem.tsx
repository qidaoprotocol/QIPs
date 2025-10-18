import React from 'react';
import { Link } from 'react-router-dom';
import Author from './Author';
import { useQueryClient } from '@tanstack/react-query';
import { QCIClient } from '../services/qciClient';
import { getIPFSService } from '../services/getIPFSService';
import { config } from '../config/env';
import { CACHE_TIMES } from '../config/queryClient';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { SnapshotStatus } from './SnapshotStatus';
import { StatusBadge } from "@/components/ui/status-badge";
import { useQIPNumber } from '../hooks/useQIPNumber';

// Use shared StatusBadge for consistent styling across the app

// Component to display QCI or QIP label
const ProposalLabel: React.FC<{ qciNumber: number; snapshotProposalId: string | null }> = ({ qciNumber, snapshotProposalId }) => {
  const { qipNumber, hasSnapshot } = useQIPNumber(snapshotProposalId);

  if (hasSnapshot && qipNumber) {
    return <span style={{ color: '#F87171' }}>QIP {qipNumber}</span>;
  }

  return <span>QCI {qciNumber}</span>;
};

const ProposalListItem = (props: any) => {
  const { proposals } = props;
  const queryClient = useQueryClient();
  const ipfsService = getIPFSService();

  // Track ongoing prefetches to avoid duplicates
  const prefetchingRef = React.useRef<Set<number>>(new Set());

  // Prefetch QCI data on hover
  const handleMouseEnter = async (qciNumber: number) => {
    const registryAddress = config.qciRegistryAddress;
    if (!registryAddress) return;

    // Avoid duplicate prefetches
    if (prefetchingRef.current.has(qciNumber)) {
      console.log("[ProposalListItem] Already prefetching QCI:", qciNumber);
      return;
    }

    // Check if already cached
    const cacheKey = ["qci", qciNumber, registryAddress];
    const cached = queryClient.getQueryData(cacheKey);

    if (!cached) {
      console.debug(`[ProposalListItem] Prefetching QCI ${qciNumber} on hover`);
      prefetchingRef.current.add(qciNumber);

      // Prefetch the QCI data
      try {
        await queryClient.prefetchQuery({
          queryKey: cacheKey,
          queryFn: async () => {
            const qciClient = new QCIClient(registryAddress, config.baseRpcUrl, false);

            let qci;
            try {
              qci = await qciClient.getQCI(BigInt(qciNumber));
            } catch (error: any) {
              // Handle non-existent QCIs gracefully
              if (error?.message?.includes("returned no data") || error?.message?.includes("0x")) {
                console.debug(`[ProposalListItem] QCI ${qciNumber} does not exist in contract`);
                return null;
              }
              throw error;
            }

            if (!qci || qci.qciNumber === 0n) return null;

            // Also prefetch IPFS content
            const ipfsContent = await ipfsService.fetchQCI(qci.ipfsUrl);
            const { frontmatter, content } = ipfsService.parseQCIMarkdown(ipfsContent);

            // Cache IPFS separately
            queryClient.setQueryData(["ipfs", qci.ipfsUrl], {
              raw: ipfsContent,
              frontmatter,
              body: content,
              cid: qci.ipfsUrl,
            });

            const implDate =
              qci.implementationDate > 0n ? new Date(Number(qci.implementationDate) * 1000).toISOString().split("T")[0] : "None";

            return {
              qciNumber,
              title: qci.title,
              chain: qci.chain,
              status: qciClient.getStatusString(qci.status),
              author: frontmatter.author || qci.author,
              implementor: qci.implementor,
              implementationDate: implDate,
              // Filter out TBU and other placeholders
              proposal:
                qci.snapshotProposalId &&
                qci.snapshotProposalId !== "TBU" &&
                qci.snapshotProposalId !== "tbu" &&
                qci.snapshotProposalId !== "None"
                  ? qci.snapshotProposalId
                  : "None",
              created: frontmatter.created || new Date(Number(qci.createdAt) * 1000).toISOString().split("T")[0],
              content,
              ipfsUrl: qci.ipfsUrl,
              contentHash: qci.contentHash,
              version: Number(qci.version),
              source: "blockchain" as const,
              lastUpdated: Date.now(),
            };
          },
          staleTime: CACHE_TIMES.STALE_TIME.QCI_DETAIL,
          gcTime: CACHE_TIMES.GC_TIME.QCI_DETAIL,
        });
      } catch (error) {
        console.error("[ProposalListItem] Prefetch error for QCI:", qciNumber, error);
      } finally {
        // Remove from prefetching set
        prefetchingRef.current.delete(qciNumber);
      }
    } else {
      console.log("[ProposalListItem] QCI already cached:", qciNumber);
    }
  };

  // Helper function to format date to human-readable format
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Helper function to get data from proposal (handles both markdown and blockchain structures)
  const getProposalData = (proposal: any) => {
    // Check if this is a blockchain QCI (has qciNumber) or markdown QCI (has frontmatter)
    const isBlockchainQCI = proposal.qciNumber !== undefined;

    if (isBlockchainQCI) {
      return {
        qci: proposal.qciNumber,
        title: proposal.title,
        author: proposal.author,
        status: proposal.status,
        shortDescription: proposal.content?.substring(0, 200) || "",
        snapshotProposalId: proposal.proposal !== "None" ? proposal.proposal : null,
        created: proposal.created,
      };
    } else {
      // Markdown QCI structure
      return {
        qci: proposal.frontmatter?.qci,
        title: proposal.frontmatter?.title,
        author: proposal.frontmatter?.author,
        status: proposal.frontmatter?.status,
        shortDescription: proposal.frontmatter?.shortDescription || "",
        snapshotProposalId: proposal.frontmatter?.proposal !== "None" ? proposal.frontmatter?.proposal : null,
        created: proposal.frontmatter?.created,
      };
    }
  };

  return (
    <div className="space-y-3">
      {proposals.map((proposal: any, index: number) => {
        const data = getProposalData(proposal);

        return (
          <Card key={index} className="hover:shadow-lg transition-all duration-200 cursor-pointer">
            <Link to={`/qcis/${data.qci}`} className="block" onMouseEnter={() => handleMouseEnter(data.qci)}>
              <CardHeader>
                <div className="flex items-center justify-between mb-2">
                  <CardDescription className="text-sm font-medium">
                    <ProposalLabel qciNumber={data.qci} snapshotProposalId={data.snapshotProposalId} />
                    {data.created && ` - ${formatDate(data.created)}`}
                  </CardDescription>
                  <div className="flex items-center gap-2">
                    {data.snapshotProposalId ? (
                      <SnapshotStatus proposalIdOrUrl={data.snapshotProposalId} showVotes={false} compact={true} />
                    ) : (
                      <StatusBadge status={data.status} size="sm" />
                    )}
                  </div>
                </div>
                <CardTitle className="text-xl">{data.title}</CardTitle>
              </CardHeader>
            </Link>
          </Card>
        );
      })}
    </div>
  );
};

export default ProposalListItem;
