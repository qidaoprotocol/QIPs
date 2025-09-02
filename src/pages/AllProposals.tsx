import React, { useMemo } from 'react'
import ProposalListItem from '../components/ProposalListItem'
import { sortBy } from 'lodash/fp'
import { useQIPsFromAPI } from '../hooks/useQIPsFromAPI'
import Layout from '../layout'
import LocalModeBanner from '../components/LocalModeBanner'
import { config } from '../config/env'

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
}

// Status order for display
const statusOrder = ['Draft', 'Review', 'Vote', 'Approved', 'Implemented', 'Rejected', 'Withdrawn']

const AllProposals: React.FC = () => {
  // Configuration
  const localMode = config.localMode

  // Always use API for fetching QIPs (24x faster)
  const { 
    qips: blockchainQIPs, 
    isLoading: blockchainLoading, 
    isError: blockchainError,
    invalidateQIPs,
    isFetching,
    refreshQIPs
  } = useQIPsFromAPI({
    apiUrl: config.maiApiUrl,
    pollingInterval: 30000, // 30 seconds
    enabled: true
  })

  // Group QIPs by status
  const groupedQIPs = useMemo(() => {
    const groups: Record<string, any[]> = {}
    
    blockchainQIPs.forEach(qip => {
      const status = qip.status
      if (!groups[status]) {
        groups[status] = []
      }
      // Just pass the QIP as-is since ProposalListItem handles blockchain QIPs directly
      groups[status].push({
        ...qip,
        id: `api-${qip.qipNumber}`
      })
    })

    // Sort QIPs within each group by number (descending)
    Object.keys(groups).forEach(status => {
      groups[status] = sortBy(p => -p.qipNumber, groups[status])
    })

    return groups
  }, [blockchainQIPs])

  // Get ordered status groups
  const orderedGroups = statusOrder
    .filter(status => groupedQIPs[status] && groupedQIPs[status].length > 0)
    .map(status => ({
      status,
      qips: groupedQIPs[status],
      displayName: statusDisplayMap[status] || status
    }))

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4">All Proposals</h1>
          
          {localMode && <LocalModeBanner />}
          
          {/* API Mode Indicator - Always shown since we're always using API */}
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">
              ⚡ Using Mai API for faster QIP loading (24x performance improvement)
            </p>
          </div>
          
          {blockchainError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <p className="font-bold">Error loading from API</p>
              <p className="text-sm">Please check your connection and try again.</p>
              <button 
                onClick={() => refreshQIPs()}
                className="mt-2 bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}

          {blockchainLoading && !blockchainQIPs.length && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
              <span className="ml-3">Loading proposals from API...</span>
            </div>
          )}

          {!blockchainLoading && !blockchainError && blockchainQIPs.length === 0 && (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
              <p className="font-bold">No proposals found</p>
              <p className="text-sm">There are no proposals in the registry yet.</p>
            </div>
          )}
        </div>

        <div className="space-y-8">
          {orderedGroups.map(({ status, qips, displayName }) => (
            <div key={status} className="proposal-list-container">
              <div className="shadow-s p-5 bg-white rounded-t-lg">
                <h3 className="text-2xl font-semibold mb-3 flex items-center">
                  {displayName}
                  <span className="ml-2 text-sm text-gray-500">({qips.length})</span>
                  {isFetching && (
                    <div className="ml-2 animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                  )}
                </h3>
              </div>
              <ProposalListItem proposals={qips} />
            </div>
          ))}
        </div>

        {/* Refresh button for development */}
        {process.env.NODE_ENV === 'development' && (
          <div className="fixed bottom-4 right-4">
            <button
              onClick={() => invalidateQIPs()}
              className="bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg hover:bg-blue-700 flex items-center"
              disabled={isFetching}
            >
              {isFetching ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Refreshing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </Layout>
  )
}

export default AllProposals