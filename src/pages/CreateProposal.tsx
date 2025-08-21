import React from 'react'
import Layout from '../layout'
import { ProposalEditor } from '../components/ProposalEditor'
import { config } from '../config'

const CreateProposal: React.FC = () => {

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <ProposalEditor 
          registryAddress={config.qipRegistryAddress}
          rpcUrl={config.baseRpcUrl}
        />
      </div>
    </Layout>
  )
}

export default CreateProposal