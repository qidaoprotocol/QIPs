import React from 'react';
import { Link } from 'react-router-dom';
import Author from './Author';
import { useQueryClient } from '@tanstack/react-query';
import { QIPClient } from '../services/qipClient';
import { getIPFSService } from '../services/getIPFSService';
import { config } from '../config/env';
import { CACHE_TIMES } from '../config/queryClient';
// Proposal list item component

const statusColor:any = {
    Draft: '#757575',
    Review: '#FFEB3B',           // Changed from 'Review Pending'
    'Review Pending': '#FFEB3B', // Keep for backward compatibility
    Vote: '#FFEB3B',             // Changed from 'Vote Pending'
    'Vote Pending': '#FFEB3B',   // Keep for backward compatibility
    Rejected: '#F44336',
    Approved: '#4CAF50',
    Implemented: '#4CAF50',
    Superseded: '#9E9E9E',       // Added
    Withdrawn: '#9E9E9E',        // Added
    Templates: '#757575',
};

const ProposalListItem = (props: any) => {
    const { proposals } = props;
    const queryClient = useQueryClient();
    const ipfsService = getIPFSService();
    
    // Prefetch QIP data on hover
    const handleMouseEnter = async (qipNumber: number) => {
        const registryAddress = config.qipRegistryAddress;
        if (!registryAddress) return;
        
        // Check if already cached
        const cacheKey = ['qip', qipNumber, registryAddress];
        const cached = queryClient.getQueryData(cacheKey);
        
        if (!cached) {
            console.debug(`[ProposalListItem] Prefetching QIP ${qipNumber} on hover`);
            
            // Prefetch the QIP data
            queryClient.prefetchQuery({
                queryKey: cacheKey,
                queryFn: async () => {
                    const qipClient = new QIPClient(registryAddress, config.baseRpcUrl, false);
                    const qip = await qipClient.getQIP(BigInt(qipNumber));
                    
                    if (!qip || qip.qipNumber === 0n) return null;
                    
                    // Also prefetch IPFS content
                    const ipfsContent = await ipfsService.fetchQIP(qip.ipfsUrl);
                    const { frontmatter, content } = ipfsService.parseQIPMarkdown(ipfsContent);
                    
                    // Cache IPFS separately
                    queryClient.setQueryData(['ipfs', qip.ipfsUrl], {
                        raw: ipfsContent,
                        frontmatter,
                        body: content,
                        cid: qip.ipfsUrl,
                    });
                    
                    const implDate = qip.implementationDate > 0n 
                        ? new Date(Number(qip.implementationDate) * 1000).toISOString().split('T')[0]
                        : 'None';
                    
                    return {
                        qipNumber,
                        title: qip.title,
                        network: qip.network,
                        status: qipClient.getStatusString(qip.status),
                        author: frontmatter.author || qip.author,
                        implementor: qip.implementor,
                        implementationDate: implDate,
                        // Filter out TBU and other placeholders
                        proposal: (qip.snapshotProposalId && 
                                  qip.snapshotProposalId !== 'TBU' && 
                                  qip.snapshotProposalId !== 'tbu' &&
                                  qip.snapshotProposalId !== 'None') 
                                  ? qip.snapshotProposalId 
                                  : 'None',
                        created: frontmatter.created || new Date(Number(qip.createdAt) * 1000).toISOString().split('T')[0],
                        content,
                        ipfsUrl: qip.ipfsUrl,
                        contentHash: qip.contentHash,
                        version: Number(qip.version),
                        source: 'blockchain' as const,
                        lastUpdated: Date.now()
                    };
                },
                staleTime: CACHE_TIMES.STALE_TIME.QIP_DETAIL,
                gcTime: CACHE_TIMES.GC_TIME.QIP_DETAIL,
            });
        }
    };

    // Helper function to get data from proposal (handles both markdown and blockchain structures)
    const getProposalData = (proposal: any) => {
        // Check if this is a blockchain QIP (has qipNumber) or markdown QIP (has frontmatter)
        const isBlockchainQIP = proposal.qipNumber !== undefined;
        
        if (isBlockchainQIP) {
            return {
                qip: proposal.qipNumber,
                title: proposal.title,
                author: proposal.author,
                status: proposal.status,
                shortDescription: proposal.content?.substring(0, 200) || ''
            };
        } else {
            // Markdown QIP structure
            return {
                qip: proposal.frontmatter?.qip,
                title: proposal.frontmatter?.title,
                author: proposal.frontmatter?.author,
                status: proposal.frontmatter?.status,
                shortDescription: proposal.frontmatter?.shortDescription || ''
            };
        }
    };

    return (
        <div className="proposal-lists mb-15">
            {proposals.map((proposal: any, index: number) => {
                const data = getProposalData(proposal);
                
                return (
                    <div
                        key={index}
                        className="border-y border-skin-border bg-skin-block-bg text-base md:rounded-xl md:border transition-colors mb-3"
                    >
                        <div className="leading-5 sm:leading-6">
                            <div>
                                <div className="block p-3 text-skin-text sm:p-4">
                                    <div>
                                        <div className="flex h-[26px] items-start justify-between">
                                            <div className="flex items-center gap-1">
                                                <div className="flex">
                                                    <button
                                                        id="headlessui-popover-button-15"
                                                        type="button"
                                                        aria-expanded="false"
                                                        data-headlessui-state=""
                                                    >
                                                        <div
                                                            className="whitespace-nowrap"
                                                            tabIndex={-1}
                                                        >
                                                            <Author
                                                                author={data.author}
                                                            />
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>
                                            <span style={{backgroundColor: statusColor[data.status]}} className="bg-[#BB6BD9] State text-white p-[1px] px-[7px] rounded-[14px] font-normal">
                                                {data.status}
                                            </span>
                                        </div>
                                        <Link
                                            to={`/qips/${data.qip}`}
                                            className="cursor-pointer"
                                            onMouseEnter={() => handleMouseEnter(data.qip)}
                                        >
                                            <div className="relative flex mb-1 mt-3 break-words pr-[80px] leading-[32px]">
                                                {/* <span className='mr-1'>
                                                    <img className='w-[25px] rounded-[20px]' src="https://cdn.stamp.fyi/avatar/eth:0xAd95A5fE898679B927C266eB2eDfAbC7fe268C27?s=40" alt="" />
                                                </span> */}

                                                <h3 className="inline pr-2">
                                                    {data.title?.startsWith(`QIP-${data.qip}`) || data.title?.startsWith(`QIP ${data.qip}`)
                                                        ? data.title
                                                        : `QIP-${data.qip}: ${data.title}`}
                                                </h3>
                                            </div>
                                            <p className="line-clamp-2 break-words text-md font-semibold">
                                                {data.shortDescription}
                                            </p>
                                            {/* Add more nested elements here */}
                                        </Link>
                                        <div className="">
                                            {/* Add more elements here */}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default ProposalListItem;
