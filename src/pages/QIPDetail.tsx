import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQIPData } from '../hooks/useQIPData'
import Layout from '../layout'
import FrontmatterTable from '../components/FrontmatterTable'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const QIPDetail: React.FC = () => {
  const { qipNumber } = useParams<{ qipNumber: string }>()
  const [qipData, setQipData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { getQIP } = useQIPData({
    registryAddress: process.env.GATSBY_QIP_REGISTRY_ADDRESS as `0x${string}`,
    useLocalIPFS: process.env.GATSBY_USE_LOCAL_IPFS === 'true',
    pinataJwt: process.env.GATSBY_PINATA_JWT || '',
    pinataGateway: process.env.GATSBY_PINATA_GATEWAY || 'https://gateway.pinata.cloud',
    localIPFSApi: process.env.GATSBY_LOCAL_IPFS_API || 'http://localhost:5001',
    localIPFSGateway: process.env.GATSBY_LOCAL_IPFS_GATEWAY || 'http://localhost:8080',
    enabled: !!process.env.GATSBY_QIP_REGISTRY_ADDRESS
  })

  useEffect(() => {
    const fetchQIP = async () => {
      if (!qipNumber) return

      try {
        setLoading(true)
        const qipQuery = getQIP(parseInt(qipNumber))
        const result = await qipQuery.refetch()
        
        if (result.data) {
          setQipData(result.data)
        } else {
          setError('QIP not found')
        }
      } catch (err) {
        console.error('Error fetching QIP:', err)
        setError('Failed to load QIP')
      } finally {
        setLoading(false)
      }
    }

    fetchQIP()
  }, [qipNumber, getQIP])

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <span className="ml-3">Loading QIP...</span>
          </div>
        </div>
      </Layout>
    )
  }

  if (error || !qipData) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <p className="font-bold">Error</p>
            <p>{error || 'QIP not found'}</p>
            <Link to="/all-proposals" className="mt-2 inline-block text-blue-600 hover:text-blue-800">
              ← Back to all proposals
            </Link>
          </div>
        </div>
      </Layout>
    )
  }

  const frontmatter = {
    qip: qipData.qipNumber,
    title: qipData.title,
    network: qipData.network,
    status: qipData.status,
    author: qipData.author,
    implementor: qipData.implementor,
    'implementation-date': qipData.implementationDate,
    proposal: qipData.proposal,
    created: qipData.created,
    version: qipData.version
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Link to="/all-proposals" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
            ← Back to all proposals
          </Link>

          <h1 className="text-4xl font-bold mb-4">
            QIP-{qipData.qipNumber}: {qipData.title}
          </h1>

          <div className="mb-6">
            <span className={`inline-block px-3 py-1 text-sm font-semibold rounded-full ${
              qipData.status === 'Draft' ? 'bg-gray-200 text-gray-800' :
              qipData.status === 'Review' ? 'bg-yellow-200 text-yellow-800' :
              qipData.status === 'Vote' ? 'bg-blue-200 text-blue-800' :
              qipData.status === 'Approved' ? 'bg-green-200 text-green-800' :
              qipData.status === 'Implemented' ? 'bg-purple-200 text-purple-800' :
              qipData.status === 'Rejected' ? 'bg-red-200 text-red-800' :
              'bg-gray-200 text-gray-800'
            }`}>
              {qipData.status}
            </span>
          </div>

          <div className="mb-8">
            <FrontmatterTable frontmatter={frontmatter} />
          </div>

          {qipData.ipfsUrl && (
            <div className="mb-4 text-sm text-gray-600">
              <span className="font-semibold">IPFS:</span>{' '}
              <a 
                href={qipData.ipfsUrl.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/')} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800"
              >
                {qipData.ipfsUrl}
              </a>
            </div>
          )}

          <div className="prose prose-lg max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {qipData.content}
            </ReactMarkdown>
          </div>

          {qipData.version > 1 && (
            <div className="mt-8 p-4 bg-gray-100 rounded">
              <p className="text-sm text-gray-600">
                This QIP has been updated {qipData.version - 1} time{qipData.version > 2 ? 's' : ''}.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

export default QIPDetail