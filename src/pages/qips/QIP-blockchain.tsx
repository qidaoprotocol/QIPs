import React, { useState, useEffect } from "react";
import { graphql } from "gatsby";
import Layout from "../../layout";
import FrontmatterTable from "../../components/FrontmatterTable";
import SnapshotSubmitter from "../../components/SnapshotSubmitter";
import { useAccount } from 'wagmi';
import { Link } from 'gatsby';

interface Props {
  data: {
    qip: {
      qipNumber: number;
      title: string;
      network: string;
      status: string;
      author: string;
      implementor: string;
      implementationDate: string;
      proposal: string;
      created: string;
      content: string;
      ipfsUrl: string;
      contentHash: string;
      version: number;
    };
  };
}

const BlockchainQIPTemplate: React.FC<Props> = ({ data }) => {
  const { qip } = data;
  const { address } = useAccount();
  const [isClient, setIsClient] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    setIsClient(true);
    // Check if user can edit (is author or has editor role)
    if (address && qip.author.toLowerCase() === address.toLowerCase()) {
      setCanEdit(true);
    }
  }, [address, qip.author]);

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
    .map(paragraph => {
      if (paragraph.startsWith('## ')) {
        return `<h2>${paragraph.slice(3)}</h2>`;
      } else if (paragraph.startsWith('### ')) {
        return `<h3>${paragraph.slice(4)}</h3>`;
      } else if (paragraph.startsWith('- ')) {
        const items = paragraph.split('\n').filter(line => line.startsWith('- '));
        return `<ul>${items.map(item => `<li>${item.slice(2)}</li>`).join('')}</ul>`;
      } else if (paragraph.startsWith('* ')) {
        const items = paragraph.split('\n').filter(line => line.startsWith('* '));
        return `<ul>${items.map(item => `<li>${item.slice(2)}</li>`).join('')}</ul>`;
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

export default BlockchainQIPTemplate;

export const pageQuery = graphql`
  query ($qipNumber: Int!) {
    qip(qipNumber: { eq: $qipNumber }) {
      qipNumber
      title
      network
      status
      author
      implementor
      implementationDate
      proposal
      created
      content
      ipfsUrl
      contentHash
      version
    }
  }
`;