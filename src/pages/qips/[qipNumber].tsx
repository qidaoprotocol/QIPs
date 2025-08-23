import React, { useState, useEffect } from "react";
import Layout from "../../layout";
import FrontmatterTable from "../../components/FrontmatterTable";
import SnapshotSubmitter from "../../components/SnapshotSubmitter";
import { StatusUpdateComponent } from "../../components/StatusUpdateComponent";
import { StatusDiscrepancyIndicator } from "../../components/StatusDiscrepancyIndicator";
import { useAccount } from 'wagmi';
import { Link } from 'gatsby';
import { useQIPData } from '../../hooks/useQIPData';
import { useUpdateQIPStatus } from '../../hooks/useUpdateQIPStatus';
import { config } from '../../config';
import { ethers } from 'ethers';
import QIPRegistryABI from '../../config/abis/QIPRegistry.json';
import { QIPStatus } from '../../services/qipClient';

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
  const [canSubmitSnapshot, setCanSubmitSnapshot] = useState(false);
  const [isAuthor, setIsAuthor] = useState(false);
  const [isEditor, setIsEditor] = useState(false);
  const { updateStatus } = useUpdateQIPStatus();
  
  // Use the hook to fetch QIP data
  const { 
    blockchainQIPs, 
    isLoading, 
    isError, 
    error, 
    invalidateQIPs 
  } = useQIPData({
    registryAddress: config.qipRegistryAddress,
    pinataGateway: config.pinataGateway,
    useLocalIPFS: config.useLocalIPFS,
  });
  
  const qip = blockchainQIPs.find((q: any) => q.qipNumber === qipNumber);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const checkPermissions = async () => {
      if (!address || !qip) {
        setCanEdit(false);
        setCanSubmitSnapshot(false);
        return;
      }

      // Check if user is author
      const authorCheck = qip.author.toLowerCase() === address.toLowerCase();
      setIsAuthor(authorCheck);
      
      // Check if user has editor or admin role
      let editorCheck = false;
      try {
        const provider = new ethers.providers.JsonRpcProvider(config.baseRpcUrl);
        const contract = new ethers.Contract(config.qipRegistryAddress, QIPRegistryABI, provider);
        
        // Check for editor role
        const editorRole = await contract.EDITOR_ROLE();
        const hasEditorRole = await contract.hasRole(editorRole, address);
        
        // Check for admin role (DEFAULT_ADMIN_ROLE is always 0x00 in OpenZeppelin AccessControl)
        // This is the standard admin role that has permission to grant/revoke other roles
        const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
        const hasAdminRole = await contract.hasRole(DEFAULT_ADMIN_ROLE, address);
        
        editorCheck = hasEditorRole || hasAdminRole;
        
        if (editorCheck) {
          console.log(`User ${address} has ${hasAdminRole ? 'admin' : 'editor'} role`);
        }
      } catch (error) {
        console.error('Error checking roles:', error);
      }
      setIsEditor(editorCheck);

      setCanEdit(authorCheck || editorCheck);
      // Editors can submit to snapshot even if they're not the author
      setCanSubmitSnapshot(authorCheck || editorCheck);
    };

    checkPermissions();
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

              {/* Status, Version and IPFS info */}
              <div className="text-center text-sm text-gray-600 mb-4">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <StatusUpdateComponent
                    qipNumber={BigInt(qip.qipNumber)}
                    currentStatus={qip.statusEnum || QIPStatus.Draft}
                    currentIpfsStatus={qip.ipfsStatus}
                    isAuthor={isAuthor}
                    isEditor={isEditor}
                    onStatusUpdate={async (newStatus) => {
                      await updateStatus(BigInt(qip.qipNumber), newStatus);
                      // Refresh the QIP data after update
                      invalidateQIPs();
                    }}
                  />
                  <StatusDiscrepancyIndicator
                    onChainStatus={qip.status}
                    ipfsStatus={qip.ipfsStatus}
                  />
                </div>
                <div>
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
              </div>

              <div className="flex justify-center sm:m-0 m-3">
                <FrontmatterTable frontmatter={frontmatter} />
              </div>

              <div className="markdown-content mt-3 p-3 md:p-none">
                <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: htmlContent }} />
              </div>

              {/* Show Snapshot submitter for eligible statuses to editors and authors */}
              {/* Also show for recently approved QIPs that don't have a proposal yet */}
              {canSubmitSnapshot && 
               ((qip.status === 'Review' || qip.status === 'Vote' || 
                (qip.status === 'Approved' && (!qip.proposal || qip.proposal === 'None'))) && 
                (!qip.proposal || qip.proposal === 'None')) && (
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