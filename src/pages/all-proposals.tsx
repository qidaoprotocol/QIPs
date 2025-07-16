import React, { useMemo } from 'react';
import { graphql } from 'gatsby';
import ProposalListItem from '../components/ProposalListItem';
import { sortBy, filter, flow } from 'lodash/fp';
import { useQIPData } from '../hooks/useQIPData';

//@ts-ignore
import statuses from '../../ps/statuses';
import Layout from '../layout';

import Templates from '../components/Templates';

interface QIPNode {
  id: string;
  qipNumber: number;
  title: string;
  author: string;
  network: string;
  proposal: string;
  implementor: string;
  created: string;
  status: string;
}

interface Props {
  data: {
    allQip: {
      group: Array<{
        fieldValue: string;
        totalCount: number;
        nodes: QIPNode[];
      }>;
    };
    templates: {
      nodes: Array<{
        parent: {
          base: string;
        };
        frontmatter: {
          qip: number;
          title: string;
          author: string;
        };
        html: string;
      }>;
    };
  };
}

// Map blockchain status strings to display strings
const statusDisplayMap: Record<string, string> = {
  'Draft': 'Draft',
  'Review': 'Review Pending',
  'Vote': 'Vote Pending',
  'Approved': 'Approved',
  'Rejected': 'Rejected',
  'Implemented': 'Implemented',
  'Superseded': 'Deprecated',
  'Withdrawn': 'Deprecated'
};

// All Proposals component
const AllProposals: React.FC<Props> = ({
  data: { allQip, templates },
}) => {
  const _statuses = statuses.map((status: any) => status.toLowerCase());
  const { group } = allQip;
  
  // Debug logging
  console.log('[all-proposals] Environment check:', {
    GATSBY_QIP_REGISTRY_ADDRESS: process.env.GATSBY_QIP_REGISTRY_ADDRESS,
    GATSBY_LOCAL_MODE: process.env.GATSBY_LOCAL_MODE,
    GATSBY_USE_LOCAL_IPFS: process.env.GATSBY_USE_LOCAL_IPFS,
  });

  // Fetch blockchain data with progressive enhancement
  const { 
    blockchainQIPs, 
    isLoading: blockchainLoading, 
    isError: blockchainError,
    invalidateQIPs,
    isFetching
  } = useQIPData({
    registryAddress: process.env.GATSBY_QIP_REGISTRY_ADDRESS as `0x${string}`,
    useLocalIPFS: process.env.GATSBY_USE_LOCAL_IPFS === 'true',
    pinataJwt: process.env.GATSBY_PINATA_JWT || '',
    pinataGateway: process.env.GATSBY_PINATA_GATEWAY || 'https://gateway.pinata.cloud',
    localIPFSApi: process.env.GATSBY_LOCAL_IPFS_API || 'http://localhost:5001',
    localIPFSGateway: process.env.GATSBY_LOCAL_IPFS_GATEWAY || 'http://localhost:8080',
    pollingInterval: 10000, // 10 seconds for faster updates in dev
    enabled: !!(process.env.GATSBY_QIP_REGISTRY_ADDRESS && process.env.GATSBY_LOCAL_MODE === 'true')
  });

  // Combine and deduplicate GitHub (GraphQL) and blockchain data
  const combinedData = useMemo(() => {
    console.log('[all-proposals] Starting data combination');
    console.log('[all-proposals] GitHub groups:', group.map(g => ({ status: g.fieldValue, count: g.totalCount })));
    console.log('[all-proposals] Blockchain QIPs:', blockchainQIPs);
    
    const githubQIPs = new Map<number, any>();
    const blockchainQIPsMap = new Map<number, any>();
    
    // First, add all GitHub QIPs
    group.forEach(statusGroup => {
      statusGroup.nodes.forEach(node => {
        githubQIPs.set(node.qipNumber, {
          ...node,
          source: 'github',
          isBlockchainEnhanced: false
        });
      });
    });
    console.log('[all-proposals] Total GitHub QIPs:', githubQIPs.size);
    
    // Then add/enhance with blockchain data
    blockchainQIPs.forEach(qip => {
      const existingGitHub = githubQIPs.get(qip.qipNumber);
      if (existingGitHub) {
        // Enhance GitHub data with blockchain data
        githubQIPs.set(qip.qipNumber, {
          ...existingGitHub,
          ...qip,
          source: 'github',
          isBlockchainEnhanced: true,
          blockchainStatus: qip.status,
          blockchainVersion: qip.version
        });
      } else {
        // New blockchain-only QIP
        blockchainQIPsMap.set(qip.qipNumber, {
          ...qip,
          id: `blockchain-${qip.qipNumber}`,
          source: 'blockchain'
        });
      }
    });
    console.log('[all-proposals] Blockchain-only QIPs:', blockchainQIPsMap.size);
    
    // Group combined data by status
    const statusGroups = new Map<string, any[]>();
    
    // Process GitHub QIPs (original and enhanced)
    [...githubQIPs.values()].forEach(qip => {
      const status = qip.isBlockchainEnhanced ? qip.blockchainStatus : qip.status;
      if (!statusGroups.has(status)) {
        statusGroups.set(status, []);
      }
      statusGroups.get(status)!.push(qip);
    });
    
    // Process blockchain-only QIPs
    [...blockchainQIPsMap.values()].forEach(qip => {
      if (!statusGroups.has(qip.status)) {
        statusGroups.set(qip.status, []);
      }
      statusGroups.get(qip.status)!.push(qip);
    });
    
    console.log('[all-proposals] Status groups:', Array.from(statusGroups.entries()).map(([s, n]) => ({ status: s, count: n.length })));
    
    // Convert back to the expected format
    return Array.from(statusGroups.entries()).map(([status, nodes]) => ({
      fieldValue: status,
      totalCount: nodes.length,
      nodes
    }));
  }, [group, blockchainQIPs]);
  
  // Map the groups to use display status names and filter valid ones
  const columns = flow(
    filter(({ fieldValue }) => {
      const displayStatus = statusDisplayMap[fieldValue] || fieldValue;
      return _statuses.indexOf(displayStatus.toLowerCase()) > -1;
    }),
    sortBy(({ fieldValue }) => {
      const displayStatus = statusDisplayMap[fieldValue] || fieldValue;
      return statuses.indexOf(displayStatus);
    })
  )(combinedData) as any;

  return (
    <Layout>
      <div className="content mt-30 overflow-y-auto h-screen flex justify-center items-start">
        <div
          id="content-center"
          className="relative w-full pl-0 lg:w-3/4 lg:pl-5 mt-20"
        >
          <div className="mb-3 space-y-3 px-3">
            <Templates templates={templates} />

            {/* Blockchain loading indicator */}
            {(blockchainLoading || isFetching) && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                    <span className="text-sm text-blue-800">
                      {blockchainLoading ? 'Loading blockchain data...' : 'Refreshing data...'}
                    </span>
                  </div>
                  {!blockchainLoading && (
                    <button
                      onClick={() => invalidateQIPs()}
                      className="text-sm text-blue-600 hover:text-blue-800 underline"
                    >
                      Refresh Now
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Blockchain error indicator */}
            {blockchainError && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
                <span className="text-sm text-yellow-800">
                  Unable to load blockchain data. Showing GitHub proposals only.
                </span>
              </div>
            )}

            <div className="mb-16"></div>

            {columns.map((column: any) => {
              // Transform nodes to match the expected structure for ProposalListItem
              const proposals = column.nodes.map((node: any) => {
                // Handle both GitHub and blockchain data structures
                if (node.source === 'blockchain') {
                  // Direct blockchain data
                  return node;
                } else {
                  // GitHub data (with or without blockchain enhancement)
                  return {
                    id: node.id,
                    frontmatter: {
                      qip: node.qipNumber,
                      title: node.title,
                      author: node.author,
                      network: node.network,
                      proposal: node.proposal,
                      implementor: node.implementor,
                      created: node.created,
                      status: node.isBlockchainEnhanced ? node.blockchainStatus : node.status
                    },
                    // Pass through blockchain enhancement info
                    isBlockchainEnhanced: node.isBlockchainEnhanced,
                    blockchainVersion: node.blockchainVersion
                  };
                }
              });
              
              const sortedProposals = sortBy((p: any) => {
                const qipNumber = p.qipNumber || p.frontmatter?.qip;
                return -qipNumber;
              }, proposals);
              
              // Get display status name
              const displayStatus = statusDisplayMap[column.fieldValue] || column.fieldValue;
              
              return (
                <div
                  key={column.fieldValue}
                  className="proposal-list-container"
                >
                  <div className="shadow-s p-5">
                    <h3 className="text-2xl font-semibold mb-3 flex items-center">
                      {displayStatus}
                      {blockchainLoading && (
                        <div className="ml-2 animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                      )}
                    </h3>
                  </div>

                  <ProposalListItem proposals={sortedProposals} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export const query = graphql`
  query {
    allQip {
      group(field: { status: SELECT }) {
        fieldValue
        totalCount
        nodes {
          id
          qipNumber
          title
          author
          network
          proposal
          implementor
          created
          status
        }
      }
    }

    templates: allMarkdownRemark(filter: { fileAbsolutePath: { regex: "/template/" } }) {
      nodes {
        parent {
          ... on File {
            base
          }
        }
        frontmatter {
          qip
          title
          author
        }
        html
      }
    }
  }
`;

export default AllProposals;