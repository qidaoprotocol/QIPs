import React, { useMemo, useState } from 'react'
import ProposalListItem from '../components/ProposalListItem'
import { sortBy } from 'lodash/fp'
import { useQCIData } from '../hooks/useQCIData'
import { useQIPNumbers } from '../hooks/useQIPNumbers'
import LocalModeBanner from '../components/LocalModeBanner'
import CacheStatusIndicator from '../components/CacheStatusIndicator'
import { StatusGroupSkeleton } from '../components/QCISkeleton'
import { config } from '../config/env'
import { showDevTools } from '../config/debug'
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";


const AllProposals: React.FC = () => {
  const localMode = config.localMode;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [qciSectionCollapsed, setQciSectionCollapsed] = useState(false);
  const [qipSectionCollapsed, setQipSectionCollapsed] = useState(false);
  const [draftsCollapsed, setDraftsCollapsed] = useState(false);
  const [readyForSnapshotCollapsed, setReadyForSnapshotCollapsed] = useState(false);
  const [postedToSnapshotCollapsed, setPostedToSnapshotCollapsed] = useState(false);
  const [implementedCollapsed, setImplementedCollapsed] = useState(false);

  const {
    blockchainQCIs: qcis,
    isLoading,
    isError,
    invalidateQCIs: invalidate,
    isFetching,
    dataUpdatedAt,
  } = useQCIData({
    enabled: true,
  });

  // Fetch QIP numbers for all proposals with Snapshot URLs
  const qipNumberMap = useQIPNumbers(qcis);

  // Handle manual refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await invalidate();
      console.log("[AllProposals] Manual refresh triggered");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Group QCIs by category and status
  const categorizedQCIs = useMemo(() => {
    const categories = {
      qci: {
        drafts: [] as any[],
        readyForSnapshot: [] as any[]
      },
      qip: {
        postedToSnapshot: [] as any[],
        implemented: [] as any[]
      },
      archived: [] as any[]
    };

    qcis.forEach((qci) => {
      const proposalData = {
        ...qci,
        id: `blockchain-${qci.qciNumber}`,
        frontmatter: {
          qci: qci.qciNumber,
          title: qci.title,
          author: qci.author,
          chain: qci.chain,
          proposal: qci.proposal,
          implementor: qci.implementor,
          created: qci.created,
          status: qci.status,
        },
        // Add QIP number from the map
        qipNumber: qipNumberMap.get(qci.qciNumber) || null,
      };

      // Categorize by status
      switch (qci.status) {
        case "Draft":
          categories.qci.drafts.push(proposalData);
          break;
        case "Ready for Snapshot":
          categories.qci.readyForSnapshot.push(proposalData);
          break;
        case "Posted to Snapshot":
          categories.qip.postedToSnapshot.push(proposalData);
          break;
        case "Implemented":
          categories.qip.implemented.push(proposalData);
          break;
        case "Archived":
          categories.archived.push(proposalData);
          break;
      }
    });

    // Sort QCI sections by QCI number (descending)
    categories.qci.drafts = sortBy((p) => -p.qciNumber, categories.qci.drafts);
    categories.qci.readyForSnapshot = sortBy((p) => -p.qciNumber, categories.qci.readyForSnapshot);

    // Sort QIP sections by QIP number (descending), fallback to QCI number if no QIP number
    const sortByQIPNumber = (proposals: any[]) => {
      return proposals.sort((a, b) => {
        const aQIP = a.qipNumber ?? -1;
        const bQIP = b.qipNumber ?? -1;

        // If both have QIP numbers, sort by QIP number (descending)
        if (aQIP !== -1 && bQIP !== -1) {
          return bQIP - aQIP;
        }

        // If only one has QIP number, prioritize it
        if (aQIP !== -1) return -1;
        if (bQIP !== -1) return 1;

        // If neither has QIP number, sort by QCI number (descending)
        return b.qciNumber - a.qciNumber;
      });
    };

    categories.qip.postedToSnapshot = sortByQIPNumber(categories.qip.postedToSnapshot);
    categories.qip.implemented = sortByQIPNumber(categories.qip.implemented);
    categories.archived = sortBy((p) => -p.qciNumber, categories.archived);

    return categories;
  }, [qcis, qipNumberMap]);


  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-4xl font-bold">Governance Hub</h1>
            {showDevTools && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing || isFetching}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Refresh proposals"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing || isFetching ? "animate-spin" : ""}`} />
                {isRefreshing || isFetching ? "Refreshing..." : "Refresh"}
              </button>
            )}
          </div>

          {localMode && <LocalModeBanner />}

          {showDevTools && dataUpdatedAt && !isLoading && (
            <div className="text-sm text-muted-foreground mb-2">Last updated: {new Date(dataUpdatedAt).toLocaleTimeString()}</div>
          )}

          {isError && (
            <div className="bg-destructive/10 border border-red-400 text-destructive px-4 py-3 rounded mb-4">
              <p className="font-bold">Error loading data</p>
              <p className="text-sm">Please check your connection and try again.</p>
              <button
                onClick={() => invalidate()}
                className="mt-2 bg-destructive text-white px-3 py-1 rounded text-sm hover:bg-destructive/90"
              >
                Retry
              </button>
            </div>
          )}

          {/* Show skeletons on initial load */}
          {isLoading && qcis.length === 0 && (
            <div className="space-y-8">
              <StatusGroupSkeleton />
              <StatusGroupSkeleton />
              <StatusGroupSkeleton />
            </div>
          )}

          {!isLoading && !isError && qcis.length === 0 && (
            <div className="bg-yellow-500/10 border border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded">
              <p className="font-bold">No proposals found</p>
              <p className="text-sm">There are no proposals in the registry yet.</p>
            </div>
          )}
        </div>

        {/* Show skeletons while refetching in background */}
        {isFetching && !isLoading && (
          <div className="space-y-8">
            <StatusGroupSkeleton />
            <StatusGroupSkeleton />
            <StatusGroupSkeleton />
          </div>
        )}

        {/* Show actual content when not fetching or when we have cached data */}
        <div className={`space-y-8 ${isFetching && !isLoading ? "hidden" : ""}`}>
          {/* QCI Section */}
          {(categorizedQCIs.qci.drafts.length > 0 || categorizedQCIs.qci.readyForSnapshot.length > 0) && (
            <div>
              <h2
                className="text-3xl font-bold mb-6 flex items-center gap-2 cursor-pointer select-none"
                onClick={() => setQciSectionCollapsed(!qciSectionCollapsed)}
              >
                <span className="transition-transform duration-200">
                  {qciSectionCollapsed ? <ChevronRight className="h-6 w-6" /> : <ChevronDown className="h-6 w-6" />}
                </span>
                🧠 QiDao Community Ideas (QCI)
                <span className="text-sm font-normal text-muted-foreground">
                  ({categorizedQCIs.qci.drafts.length + categorizedQCIs.qci.readyForSnapshot.length})
                </span>
              </h2>

              {!qciSectionCollapsed && (
                <div className="animate-in slide-in-from-top-2 duration-200 ml-6 space-y-6">
                  {/* Drafts Subsection */}
                  {categorizedQCIs.qci.drafts.length > 0 && (
                    <div>
                      <h3
                        className="text-xl font-semibold mb-3 flex items-center gap-2 cursor-pointer select-none"
                        onClick={() => setDraftsCollapsed(!draftsCollapsed)}
                      >
                        <span className="transition-transform duration-200">
                          {draftsCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                        Drafts
                        <span className="text-sm font-normal text-muted-foreground">({categorizedQCIs.qci.drafts.length})</span>
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3 ml-6">
                        Early-stage ideas, open for community feedback.
                      </p>
                      {!draftsCollapsed && (
                        <div className="animate-in slide-in-from-top-2 duration-200">
                          <ProposalListItem proposals={categorizedQCIs.qci.drafts} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Ready for Snapshot Subsection */}
                  {categorizedQCIs.qci.readyForSnapshot.length > 0 && (
                    <div>
                      <h3
                        className="text-xl font-semibold mb-3 flex items-center gap-2 cursor-pointer select-none"
                        onClick={() => setReadyForSnapshotCollapsed(!readyForSnapshotCollapsed)}
                      >
                        <span className="transition-transform duration-200">
                          {readyForSnapshotCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                        Ready for Snapshot
                        <span className="text-sm font-normal text-muted-foreground">({categorizedQCIs.qci.readyForSnapshot.length})</span>
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3 ml-6">
                        Any DAO member with ≥150K aveQI can promote these QCIs into QIPs.
                      </p>
                      {!readyForSnapshotCollapsed && (
                        <div className="animate-in slide-in-from-top-2 duration-200">
                          <ProposalListItem proposals={categorizedQCIs.qci.readyForSnapshot} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* QIP Section */}
          {(categorizedQCIs.qip.postedToSnapshot.length > 0 || categorizedQCIs.qip.implemented.length > 0) && (
            <div>
              <h2
                className="text-3xl font-bold mb-6 flex items-center gap-2 cursor-pointer select-none"
                onClick={() => setQipSectionCollapsed(!qipSectionCollapsed)}
              >
                <span className="transition-transform duration-200">
                  {qipSectionCollapsed ? <ChevronRight className="h-6 w-6" /> : <ChevronDown className="h-6 w-6" />}
                </span>
                ⚡️ QiDao Improvement Proposals (QIP)
                <span className="text-sm font-normal text-muted-foreground">
                  ({categorizedQCIs.qip.postedToSnapshot.length + categorizedQCIs.qip.implemented.length})
                </span>
              </h2>

              {!qipSectionCollapsed && (
                <div className="animate-in slide-in-from-top-2 duration-200 ml-6 space-y-6">
                  {/* Posted to Snapshot Subsection */}
                  {categorizedQCIs.qip.postedToSnapshot.length > 0 && (
                    <div>
                      <h3
                        className="text-xl font-semibold mb-3 flex items-center gap-2 cursor-pointer select-none"
                        onClick={() => setPostedToSnapshotCollapsed(!postedToSnapshotCollapsed)}
                      >
                        <span className="transition-transform duration-200">
                          {postedToSnapshotCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                        Posted on Snapshot
                        <span className="text-sm font-normal text-muted-foreground">({categorizedQCIs.qip.postedToSnapshot.length})</span>
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3 ml-6">
                        Governance in its final form, any user with an aveQI balance can vote to decide the outcome.
                      </p>
                      {!postedToSnapshotCollapsed && (
                        <div className="animate-in slide-in-from-top-2 duration-200">
                          <ProposalListItem proposals={categorizedQCIs.qip.postedToSnapshot} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Implemented Subsection */}
                  {categorizedQCIs.qip.implemented.length > 0 && (
                    <div>
                      <h3
                        className="text-xl font-semibold mb-3 flex items-center gap-2 cursor-pointer select-none"
                        onClick={() => setImplementedCollapsed(!implementedCollapsed)}
                      >
                        <span className="transition-transform duration-200">
                          {implementedCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                        Implemented
                        <span className="text-sm font-normal text-muted-foreground">({categorizedQCIs.qip.implemented.length})</span>
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3 ml-6">
                        Proposals that have been successfully implemented and deployed.
                      </p>
                      {!implementedCollapsed && (
                        <div className="animate-in slide-in-from-top-2 duration-200">
                          <ProposalListItem proposals={categorizedQCIs.qip.implemented} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Archived Section */}
          {categorizedQCIs.archived.length > 0 && (
            <div>
              <h2
                className="text-3xl font-bold mb-6 flex items-center gap-2 cursor-pointer select-none"
                onClick={() => setArchivedCollapsed(!archivedCollapsed)}
              >
                <span className="transition-transform duration-200">
                  {archivedCollapsed ? <ChevronRight className="h-6 w-6" /> : <ChevronDown className="h-6 w-6" />}
                </span>
                🗄️ Archived
                <span className="text-sm font-normal text-muted-foreground">({categorizedQCIs.archived.length})</span>
              </h2>
              <p className="text-sm text-muted-foreground mb-3 ml-6">
                Ideas discarded by the author or that didn't meet quorum to advance into a QIP.
              </p>
              {!archivedCollapsed && (
                <div className="animate-in slide-in-from-top-2 duration-200">
                  <ProposalListItem proposals={categorizedQCIs.archived} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Total count indicator */}
        {qcis.length > 0 && (
          <div className="py-8 text-center text-gray-500">
            <p>{qcis.length} proposals total</p>
          </div>
        )}

        {/* Cache status indicator for debugging */}
        <CacheStatusIndicator
          dataUpdatedAt={dataUpdatedAt}
          isFetching={isFetching}
          isStale={false}
          source={config.useMaiApi ? "api" : "blockchain"}
          cacheHit={!isLoading && dataUpdatedAt ? true : false}
        />
      </div>
    </div>
  );
};

export default AllProposals