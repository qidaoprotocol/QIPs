import React, { useState, useEffect } from "react";
import Layout from "../../layout";
import FrontmatterTable from "../../components/FrontmatterTable";
import SnapshotSubmitter from "../../components/SnapshotSubmitter";
import { useAccount } from 'wagmi';
import { Link } from 'gatsby';
import { useQIPData } from '../../hooks/useQIPData';

interface Props {
  params?: {
    qipNumber: string;
  };
  location?: {
    pathname: string;
  };
}

const DynamicQIPPage: React.FC<Props> = ({ params, location }) => {
  // Extract QIP number from URL path
  const pathname = location?.pathname || '';
  const match = pathname.match(/\/qips\/QIP-(\d+)/);
  const qipNumber = match ? parseInt(match[1]) : (params ? parseInt(params.qipNumber.replace('QIP-', '')) : 0);
  const { address } = useAccount();
  const [isClient, setIsClient] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  
  // Use the hook to fetch QIP data
  const { 
    blockchainQIPs, 
    isLoading, 
    isError, 
    error, 
    invalidateQIPs 
  } = useQIPData({
    registryAddress: process.env.GATSBY_QIP_REGISTRY_ADDRESS as `0x${string}`,
    pinataJwt: process.env.GATSBY_PINATA_JWT,
    pinataGateway: process.env.GATSBY_PINATA_GATEWAY,
    useLocalIPFS: process.env.GATSBY_USE_LOCAL_IPFS === 'true',
  });
  
  const qip = blockchainQIPs.find((q: any) => q.qipNumber === qipNumber);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (address && qip && qip.author.toLowerCase() === address.toLowerCase()) {
      setCanEdit(true);
    }
  }, [address, qip]);

  // Show loading state
  if (isLoading) {
    return (
      <Layout>
        <div className="container max-w-full">
          <div className="content mt-30 overflow-y-auto h-screen flex justify-center items-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading QIP-{qipNumber}...</p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Show error state
  if (isError && error) {
    return (
      <Layout>
        <div className="container max-w-full">
          <div className="content mt-30 overflow-y-auto h-screen flex justify-center items-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-red-600 mb-4">Error Loading QIP</h1>
              <p className="text-gray-600 mb-4">{error.message}</p>
              <button 
                onClick={() => invalidateQIPs()}
                className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Show 404 if QIP not found
  if (!qip) {
    return (
      <Layout>
        <div className="container max-w-full">
          <div className="content mt-30 overflow-y-auto h-screen flex justify-center items-center">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-gray-800 mb-4">QIP Not Found</h1>
              <p className="text-gray-600 mb-4">QIP-{qipNumber} does not exist or hasn't been created yet.</p>
              <div className="space-x-4">
                <Link 
                  to="/all-proposals"
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  View All QIPs
                </Link>
                <Link 
                  to="/create-proposal"
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  Create New QIP
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Convert QIP data to frontmatter format for compatibility
  const frontmatter = {
    qip: qip.qipNumber,
    title: qip.title,
    author: qip.author,
    network: qip.network,
    type: '', // Not stored on-chain
    proposal: qip.proposal,
    implementor: qip.implementor,
    release: '', // Not stored on-chain
    created: qip.created,
    updated: '', // Use version instead
    status: qip.status
  };

  // Convert markdown to HTML (basic conversion)
  const htmlContent = qip.content
    .split('\n\n')
    .map((paragraph: string) => {
      if (paragraph.startsWith('## ')) {
        return `<h2>${paragraph.slice(3)}</h2>`;
      } else if (paragraph.startsWith('### ')) {
        return `<h3>${paragraph.slice(4)}</h3>`;
      } else if (paragraph.startsWith('- ')) {
        const items = paragraph.split('\n').filter((line: string) => line.startsWith('- '));
        return `<ul>${items.map((item: string) => `<li>${item.slice(2)}</li>`).join('')}</ul>`;
      } else if (paragraph.startsWith('* ')) {
        const items = paragraph.split('\n').filter((line: string) => line.startsWith('* '));
        return `<ul>${items.map((item: string) => `<li>${item.slice(2)}</li>`).join('')}</ul>`;
      } else {
        return `<p>${paragraph}</p>`;
      }
    })
    .join('\n');

  return (
    <Layout>
      <div className="container max-w-full">
        <div className="content mt-30 overflow-y-auto h-screen flex justify-center items-start">
          <div id="content-center" className="relative w-full pl-0 lg:w-3/4 lg:pl-5 mt-20">
            <div className="">
              {/* Add large title at the top */}
              <h1 className="text-3xl md:text-4xl font-bold text-center mb-6 pt-10">
                QIP-{qip.qipNumber}: {qip.title}
              </h1>

              {/* Version and IPFS info */}
              <div className="text-center text-sm text-gray-600 mb-4">
                Version {qip.version} • 
                <a 
                  href={`https://ipfs.io/ipfs/${qip.ipfsUrl.replace('ipfs://', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline ml-2"
                >
                  View on IPFS
                </a>
                {canEdit && qip.status === 'Draft' && (
                  <Link 
                    to={`/edit-proposal?qip=${qip.qipNumber}`}
                    className="ml-4 text-indigo-600 hover:underline"
                  >
                    Edit Proposal
                  </Link>
                )}
              </div>

              <div className="flex justify-center sm:m-0 m-3">
                <FrontmatterTable frontmatter={frontmatter} />
              </div>

              <div className="markdown-content mt-3 p-3 md:p-none">
                <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: htmlContent }} />
              </div>

              {/* Only show Snapshot submitter for eligible statuses */}
              {(qip.status === 'Review' || qip.status === 'Vote') && !qip.proposal && (
                <div className="flex flex-col w-full gap-y-3 items-left pb-10">
                  <span className="text-2xl font-bold text-black">Submit to Snapshot</span>

                  {isClient ? (
                    <SnapshotSubmitter 
                      frontmatter={frontmatter} 
                      html={htmlContent} 
                      rawMarkdown={qip.content} 
                    />
                  ) : (
                    <div className="text-center p-4">Loading interactive module...</div>
                  )}
                </div>
              )}

              {/* Show existing Snapshot proposal link */}
              {qip.proposal && qip.proposal !== 'None' && (
                <div className="mt-6 p-4 bg-blue-50 rounded">
                  <h3 className="font-bold mb-2">Snapshot Proposal</h3>
                  <a 
                    href={qip.proposal.startsWith('http') ? qip.proposal : `https://snapshot.org/#/${qip.proposal}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    View on Snapshot →
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default DynamicQIPPage;