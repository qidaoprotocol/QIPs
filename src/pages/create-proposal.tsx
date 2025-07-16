import React from 'react';
import Layout from '../layout';
import { ProposalEditor } from '../components/ProposalEditor';

const CreateProposalPage: React.FC = () => {
  // These should come from environment variables or config
  const registryAddress = process.env.GATSBY_QIP_REGISTRY_ADDRESS as `0x${string}`;
  const pinataJwt = process.env.GATSBY_PINATA_JWT || '';
  const pinataGateway = process.env.GATSBY_PINATA_GATEWAY || '';
  const useLocalIPFS = process.env.GATSBY_USE_LOCAL_IPFS === 'true';
  const localIPFSApi = process.env.GATSBY_LOCAL_IPFS_API || 'http://localhost:5001';
  const localIPFSGateway = process.env.GATSBY_LOCAL_IPFS_GATEWAY || 'http://localhost:8080';
  const rpcUrl = process.env.GATSBY_BASE_RPC_URL || 'http://localhost:8545';
  
  // Debug logging
  console.log("🔍 CreateProposalPage Debug:");
  console.log("- GATSBY_QIP_REGISTRY_ADDRESS:", process.env.GATSBY_QIP_REGISTRY_ADDRESS);
  console.log("- GATSBY_USE_LOCAL_IPFS:", process.env.GATSBY_USE_LOCAL_IPFS);
  console.log("- GATSBY_LOCAL_IPFS_API:", process.env.GATSBY_LOCAL_IPFS_API);
  console.log("- GATSBY_LOCAL_IPFS_GATEWAY:", process.env.GATSBY_LOCAL_IPFS_GATEWAY);
  console.log("- GATSBY_PINATA_JWT:", process.env.GATSBY_PINATA_JWT ? "✅ Set" : "❌ Not set");
  console.log("- GATSBY_PINATA_GATEWAY:", process.env.GATSBY_PINATA_GATEWAY);
  console.log("- registryAddress:", registryAddress);
  console.log("- useLocalIPFS:", useLocalIPFS);
  console.log("- pinataJwt:", pinataJwt ? "✅ Set" : "❌ Not set");

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <ProposalEditor 
          registryAddress={registryAddress}
          pinataJwt={pinataJwt}
          pinataGateway={pinataGateway}
          useLocalIPFS={useLocalIPFS}
          localIPFSApi={localIPFSApi}
          localIPFSGateway={localIPFSGateway}
          rpcUrl={rpcUrl}
        />
      </div>
    </Layout>
  );
};

export default CreateProposalPage;

export const Head = () => <title>Create QIP - QiDAO Improvement Proposals</title>;