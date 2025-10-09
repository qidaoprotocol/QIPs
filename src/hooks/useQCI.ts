import React from 'react';
import { useQuery, UseQueryOptions, useQueryClient } from '@tanstack/react-query';
import { QCIClient } from '../services/qciClient';
import { getIPFSService } from '../services/getIPFSService';
import { QCIData } from './useQCIData';
import { config } from '../config/env';
import { CACHE_TIMES } from '../config/queryClient';
import { useCachedIPFS } from './useCachedIPFS';
import { queryKeys } from '../utils/queryKeys';

interface UseQCIOptions {
  registryAddress: `0x${string}`;
  qciNumber: number;
  rpcUrl?: string;
  enabled?: boolean;
  queryOptions?: Omit<UseQueryOptions<QCIData | null>, 'queryKey' | 'queryFn'>;
}

/**
 * Hook to fetch a single QCI with its content
 */
export function useQCI({
  registryAddress,
  qciNumber,
  rpcUrl = config.baseRpcUrl,
  enabled = true,
  queryOptions = {},
}: UseQCIOptions) {
  const qciClient = new QCIClient(registryAddress, rpcUrl, false);
  const ipfsService = getIPFSService();

  const queryClient = useQueryClient();


  return useQuery<QCIData | null>({
    queryKey: queryKeys.qci(qciNumber, registryAddress),
    queryFn: async () => {
      if (!qciClient || qciNumber <= 0) return null;

      try {
        console.log(`[useQCI] 🔍 Fetching QCI-${qciNumber}...`);

        // If no full cache, we need to fetch and assemble the data
        // Step 1: Get blockchain data (check cache first)
        const cachedBlockchain = queryClient.getQueryData<any>(queryKeys.qciBlockchain(qciNumber, registryAddress));
        
        let qci;
        if (cachedBlockchain) {
          console.log(`[useQCI] ✓ Using cached blockchain data for QCI-${qciNumber}`);
          qci = cachedBlockchain;
        } else {
          console.log(`[useQCI] 🌐 Fetching blockchain data for QCI-${qciNumber}`);
          try {
            qci = await qciClient.getQCI(BigInt(qciNumber));
            
            // Cache the blockchain data
            queryClient.setQueryData(queryKeys.qciBlockchain(qciNumber, registryAddress), qci, {
              updatedAt: Date.now(),
            });
          } catch (error: any) {
            // Handle the case where QCI doesn't exist in the contract
            if (error?.message?.includes('returned no data') || error?.message?.includes('0x')) {
              console.log(`[useQCI] QCI-${qciNumber} does not exist in contract (returned 0x)`);
              return null;
            }
            // Re-throw other errors
            throw error;
          }
        }
        
        // Check if QCI exists
        if (!qci || qci.qciNumber === 0n) {
          console.log(`[useQCI] ❌ QCI-${qciNumber} does not exist`);
          return null;
        }

        // Step 2: Get IPFS content (check cache first)
        const ipfsCacheKey = queryKeys.ipfs(qci.ipfsUrl);
        const cachedIPFS = queryClient.getQueryData<any>(ipfsCacheKey);
        
        let ipfsContent, frontmatter, content;

        if (cachedIPFS) {
          console.log(`[useQCI] ✓ Using cached IPFS content for QCI-${qciNumber}`, {
            cacheKeys: Object.keys(cachedIPFS),
            hasRaw: !!cachedIPFS.raw,
            hasBody: !!cachedIPFS.body,
            hasFrontmatter: !!cachedIPFS.frontmatter,
            rawLength: cachedIPFS.raw?.length,
            bodyLength: cachedIPFS.body?.length
          });

          // If we have already parsed content (from prefetch), use it directly
          // Check if this is a structured cache entry (has 'raw' field) with parsed data
          // Note: useQCIDataPaginated uses 'content' field, ProposalListItem uses 'body' field
          if (cachedIPFS.raw && cachedIPFS.frontmatter && ('body' in cachedIPFS || 'content' in cachedIPFS)) {
            console.log(`[useQCI] ✅ Using pre-parsed cached content for QCI-${qciNumber}`);
            frontmatter = cachedIPFS.frontmatter;
            // Handle both field names and ensure content is never undefined
            content = cachedIPFS.body || cachedIPFS.content || '';
          } else {
            // Otherwise, parse the raw content
            // If cachedIPFS.raw exists, use it; otherwise cachedIPFS itself is the raw content
            ipfsContent = cachedIPFS.raw || cachedIPFS;
            const parsed = ipfsService.parseQCIMarkdown(ipfsContent);

            frontmatter = parsed.frontmatter;
            content = parsed.content;
          }

        } else {
          console.log(`[useQCI] 🌐 Fetching IPFS content for QCI-${qciNumber} from ${qci.ipfsUrl}`);
          ipfsContent = await ipfsService.fetchQCI(qci.ipfsUrl);
          const parsed = ipfsService.parseQCIMarkdown(ipfsContent);

          frontmatter = parsed.frontmatter;
          content = parsed.content;

          // Cache IPFS content
          queryClient.setQueryData(ipfsCacheKey, {
            raw: ipfsContent,
            frontmatter,
            body: content,
            cid: qci.ipfsUrl,
          }, {
            updatedAt: Date.now(),
          });
        }
        
        // Step 3: Assemble the full QCI data
        const implDate = qci.implementationDate > 0n 
          ? new Date(Number(qci.implementationDate) * 1000).toISOString().split('T')[0]
          : 'None';
        
        const fullQCIData: QCIData = {
          qciNumber,
          title: qci.title,
          chain: qci.chain,
          status: qciClient.getStatusString(qci.status), // On-chain status (source of truth)
          statusEnum: qci.status, // Include the enum value
          ipfsStatus: frontmatter.status, // Status from IPFS (may differ)
          author: frontmatter.author || qci.author,
          implementor: qci.implementor,
          implementationDate: implDate,
          // Filter out TBU and other placeholders
          proposal: (qci.snapshotProposalId &&
                    qci.snapshotProposalId !== 'TBU' &&
                    qci.snapshotProposalId !== 'tbu' &&
                    qci.snapshotProposalId !== 'None')
                    ? qci.snapshotProposalId
                    : 'None',
          created: frontmatter.created || new Date(Number(qci.createdAt) * 1000).toISOString().split('T')[0],
          // Ensure content is never undefined - use empty string as fallback
          content: content || '',
          ipfsUrl: qci.ipfsUrl,
          contentHash: qci.contentHash,
          version: Number(qci.version),
          source: 'blockchain' as const,
          lastUpdated: Date.now()
        };

        
        console.log(`[useQCI] ✅ Assembled full QCI-${qciNumber} data`);
        return fullQCIData;
      } catch (error) {
        console.error(`[useQCI] ❌ Error fetching QCI ${qciNumber}:`, error);
        throw error;
      }
    },
    enabled: enabled && !!registryAddress && qciNumber > 0,
    staleTime: 0, // Consider data immediately stale to ensure fresh fetches
    gcTime: CACHE_TIMES.GC_TIME.QCI_DETAIL, // 1 hour
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus
    ...queryOptions,
  });
}