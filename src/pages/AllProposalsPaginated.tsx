import React, { useMemo, useEffect, useRef, useCallback } from 'react'
import ProposalListItem from '../components/ProposalListItem'
import { sortBy } from 'lodash/fp'
import { useQIPDataPaginated } from '../hooks/useQIPDataPaginated'
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

const AllProposalsPaginated: React.FC = () => {
  const registryAddress = config.qipRegistryAddress
  const localMode = config.localMode
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const {
    qips,
    totalCount,
    currentPage,
    totalPages,
    hasMore,
    isLoading,
    isError,
    isFetchingMore,
    loadMore,
    invalidate,
  } = useQIPDataPaginated({
    registryAddress,
    pageSize: 10,
    enabled: !!registryAddress
  })

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!hasMore || isFetchingMore || isLoading) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    const currentRef = loadMoreRef.current
    if (currentRef) {
      observer.observe(currentRef)
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef)
      }
    }
  }, [hasMore, isFetchingMore, isLoading, loadMore])

  // Group QIPs by status
  const groupedQIPs = useMemo(() => {
    const groups: Record<string, any[]> = {}
    
    qips.forEach(qip => {
      const status = qip.status
      if (!groups[status]) {
        groups[status] = []
      }
      groups[status].push({
        ...qip,
        id: `blockchain-${qip.qipNumber}`,
        frontmatter: {
          qip: qip.qipNumber,
          title: qip.title,
          author: qip.author,
          network: qip.network,
          proposal: qip.proposal,
          implementor: qip.implementor,
          created: qip.created,
          status: qip.status
        }
      })
    })

    // Sort QIPs within each group by number (descending)
    Object.keys(groups).forEach(status => {
      groups[status] = sortBy(p => -p.qipNumber, groups[status])
    })

    return groups
  }, [qips])

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
          
          {/* Stats bar */}
          {!isLoading && totalCount > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="flex justify-center items-center">
                <div>
                  <span className="text-sm text-gray-600">Loaded </span>
                  <span className="font-semibold">{qips.length}</span>
                  <span className="text-sm text-gray-600"> of </span>
                  <span className="font-semibold">{totalCount}</span>
                  <span className="text-sm text-gray-600"> proposals</span>
                </div>
              </div>
            </div>
          )}
          
          {isError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <p className="font-bold">Error loading data</p>
              <p className="text-sm">Please check your connection and try again.</p>
              <button 
                onClick={() => invalidate()}
                className="mt-2 bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}

          {isLoading && qips.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
              <span className="ml-3">Loading proposals from blockchain...</span>
            </div>
          )}

          {!isLoading && !isError && qips.length === 0 && (
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
                </h3>
              </div>
              <ProposalListItem proposals={qips} />
            </div>
          ))}
        </div>

        {/* Load more trigger */}
        {hasMore && (
          <div ref={loadMoreRef} className="py-8 text-center">
            {isFetchingMore ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                <span className="ml-3">Loading more proposals...</span>
              </div>
            ) : (
              <button
                onClick={loadMore}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Load More Proposals
              </button>
            )}
          </div>
        )}

        {/* End of list indicator */}
        {!hasMore && qips.length > 0 && (
          <div className="py-8 text-center text-gray-500">
            <p>You've reached the end • {totalCount} proposals total</p>
          </div>
        )}

        {/* Refresh button for development */}
        {process.env.NODE_ENV === 'development' && (
          <div className="fixed bottom-4 right-4">
            <button
              onClick={() => invalidate()}
              className="bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg hover:bg-blue-700 flex items-center"
              disabled={isLoading || isFetchingMore}
            >
              {isLoading || isFetchingMore ? (
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

export default AllProposalsPaginated