import React, { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Layout from '../layout'
import { useQIP } from '../hooks/useQIP'
import { ProposalEditor } from '../components/ProposalEditor'

const EditProposal: React.FC = () => {
  const [params] = useSearchParams()
  const qipParam = params.get('qip') || '0'
  const qipNumber = parseInt(qipParam, 10)

  // Use Vite env vars with Gatsby fallbacks
  const registryAddress = (import.meta.env.VITE_QIP_REGISTRY_ADDRESS || process.env.GATSBY_QIP_REGISTRY_ADDRESS) as `0x${string}`
  const useLocalIPFS = (import.meta.env.VITE_USE_LOCAL_IPFS || process.env.GATSBY_USE_LOCAL_IPFS) === 'true'
  const pinataJwt = import.meta.env.VITE_PINATA_JWT || process.env.GATSBY_PINATA_JWT || ''
  const pinataGateway = import.meta.env.VITE_PINATA_GATEWAY || process.env.GATSBY_PINATA_GATEWAY || 'https://gateway.pinata.cloud'
  const rpcUrl = import.meta.env.VITE_BASE_RPC_URL || process.env.GATSBY_BASE_RPC_URL || 'http://localhost:8545'

  const { data: qipData, isLoading, error } = useQIP({
    registryAddress,
    qipNumber,
    useLocalIPFS,
    pinataJwt,
    pinataGateway,
    rpcUrl,
    enabled: !!registryAddress && qipNumber > 0,
  })

  const existingQIP = useMemo(() => {
    if (!qipData) return undefined
    return {
      qipNumber: BigInt(qipData.qipNumber),
      content: {
        qip: qipData.qipNumber,
        title: qipData.title,
        network: qipData.network,
        status: qipData.status,
        author: qipData.author,
        implementor: qipData.implementor,
        'implementation-date': qipData.implementationDate,
        proposal: qipData.proposal,
        created: qipData.created,
        content: qipData.content,
      },
    }
  }, [qipData])

  if (!registryAddress) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <p className="font-bold">Registry not configured</p>
            <p>Please set VITE_QIP_REGISTRY_ADDRESS and reload.</p>
          </div>
        </div>
      </Layout>
    )
  }

  if (qipNumber <= 0) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
            <p className="font-bold">Invalid QIP number</p>
            <Link to="/all-proposals" className="mt-2 inline-block text-blue-600 hover:text-blue-800">
              ← Back to all proposals
            </Link>
          </div>
        </div>
      </Layout>
    )
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <span className="ml-3">Loading proposal...</span>
          </div>
        </div>
      </Layout>
    )
  }

  if (error || !existingQIP) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <p className="font-bold">Error</p>
            <p>{(error as any)?.message || 'QIP not found'}</p>
            <Link to="/all-proposals" className="mt-2 inline-block text-blue-600 hover:text-blue-800">
              ← Back to all proposals
            </Link>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <div className="mb-6">
          <Link to={`/qips/${qipNumber}`} className="text-blue-600 hover:text-blue-800">
            ← Back to QIP-{qipNumber}
          </Link>
        </div>
        <h1 className="text-3xl font-bold mb-6">Edit QIP-{qipNumber}</h1>
        <ProposalEditor
          registryAddress={registryAddress}
          pinataJwt={pinataJwt}
          pinataGateway={pinataGateway}
          useLocalIPFS={useLocalIPFS}
          localIPFSApi={import.meta.env.VITE_LOCAL_IPFS_API || process.env.GATSBY_LOCAL_IPFS_API || 'http://localhost:5001'}
          localIPFSGateway={import.meta.env.VITE_LOCAL_IPFS_GATEWAY || process.env.GATSBY_LOCAL_IPFS_GATEWAY || 'http://localhost:8080'}
          rpcUrl={rpcUrl}
          existingQIP={existingQIP}
        />
      </div>
    </Layout>
  )
}

export default EditProposal


