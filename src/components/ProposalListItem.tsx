import React from 'react';
import Author from './Author';
// Proposal list item component

const statusColor:any = {
    Draft: '#757575',
    'Review Pending': '#FFEB3B',
    'Vote Pending': '#FFEB3B',
    Rejected: '#F44336',
    Approved: '#4CAF50',
    Implemented: '#4CAF50',
    Templates: '#757575',
};

const ProposalListItem = (props: any) => {
    const { proposals } = props;

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
                                        <a
                                            href={`/qips/QIP-${data.qip}`}
                                            className="cursor-pointer"
                                        >
                                            <div className="relative flex mb-1 mt-3 break-words pr-[80px] leading-[32px]">
                                                {/* <span className='mr-1'>
                                                    <img className='w-[25px] rounded-[20px]' src="https://cdn.stamp.fyi/avatar/eth:0xAd95A5fE898679B927C266eB2eDfAbC7fe268C27?s=40" alt="" />
                                                </span> */}

                                                <h3 className="inline pr-2">
                                                    QIP{' '}
                                                    {data.qip}
                                                    :{' '}
                                                    {data.title}
                                                </h3>
                                            </div>
                                            <p className="line-clamp-2 break-words text-md font-semibold">
                                                {data.shortDescription}
                                            </p>
                                            {/* Add more nested elements here */}
                                        </a>
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
