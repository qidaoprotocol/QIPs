import React from 'react';
import { useQuery, UseQueryOptions, useQueryClient } from '@tanstack/react-query';
import { QIPClient } from '../services/qipClient';
import { getIPFSService } from '../services/getIPFSService';
import { QIPData } from './useQIPData';
import { config } from '../config/env';
import { CACHE_TIMES } from '../config/queryClient';
import { useCachedIPFS } from './useCachedIPFS';
import { queryKeys } from '../utils/queryKeys';

interface UseQIPOptions {
  registryAddress: `0x${string}`;
  qipNumber: number;
  rpcUrl?: string;
  enabled?: boolean;
  queryOptions?: Omit<UseQueryOptions<QIPData | null>, 'queryKey' | 'queryFn'>;
}

/**
 * Hook to fetch a single QIP with its content
 */
export function useQIP({
  registryAddress,
  qipNumber,
  rpcUrl = config.baseRpcUrl,
  enabled = true,
  queryOptions = {},
}: UseQIPOptions) {
  const qipClient = new QIPClient(registryAddress, rpcUrl, false);
  const ipfsService = getIPFSService();

  const queryClient = useQueryClient();


  return useQuery<QIPData | null>({
    queryKey: queryKeys.qip(qipNumber, registryAddress),
    queryFn: async () => {
      if (!qipClient || qipNumber <= 0) return null;

      try {
        // FIRST: Check if we already have the full QIP data cached from the list page
        const cachedFullQIP = queryClient.getQueryData<QIPData>(queryKeys.qip(qipNumber, registryAddress));
        if (cachedFullQIP) {
          console.log(`[useQIP] ✅ Using fully cached QIP data for QIP-${qipNumber} (no fetch needed!)`, {
            hasContent: !!cachedFullQIP.content,
            contentLength: cachedFullQIP.content?.length,
            contentPreview: cachedFullQIP.content?.substring(0, 100)
          });
          
          // Also ensure IPFS cache is set (in case it's missing)
          // This makes the cache more resilient to re-renders
          if (cachedFullQIP.ipfsUrl && cachedFullQIP.content) {
            const ipfsCacheKey = queryKeys.ipfs(cachedFullQIP.ipfsUrl);
            const existingIpfsCache = queryClient.getQueryData(ipfsCacheKey);
            if (!existingIpfsCache) {
              queryClient.setQueryData(ipfsCacheKey, {
                raw: cachedFullQIP.content, // Store content as raw for compatibility
                frontmatter: {
                  qip: cachedFullQIP.qipNumber,
                  title: cachedFullQIP.title,
                  status: cachedFullQIP.ipfsStatus || cachedFullQIP.status,
                  author: cachedFullQIP.author,
                  created: cachedFullQIP.created
                },
                body: cachedFullQIP.content,
                content: cachedFullQIP.content, // Include both for compatibility
                cid: cachedFullQIP.ipfsUrl
              }, { updatedAt: Date.now() });
            }
          }
          
          // Return a shallow copy to prevent mutation of cached data
          // This is critical to prevent React StrictMode or other components from corrupting the cache
          return { ...cachedFullQIP };
        }

        console.log(`[useQIP] 🔍 No full cache for QIP-${qipNumber}, fetching...`);

        // If no full cache, we need to fetch and assemble the data
        // Step 1: Get blockchain data (check cache first)
        const cachedBlockchain = queryClient.getQueryData<any>(queryKeys.qipBlockchain(qipNumber, registryAddress));
        
        let qip;
        if (cachedBlockchain) {
          console.log(`[useQIP] ✓ Using cached blockchain data for QIP-${qipNumber}`);
          qip = cachedBlockchain;
        } else {
          console.log(`[useQIP] 🌐 Fetching blockchain data for QIP-${qipNumber}`);
          qip = await qipClient.getQIP(BigInt(qipNumber));
          
          // Cache the blockchain data
          queryClient.setQueryData(queryKeys.qipBlockchain(qipNumber, registryAddress), qip, {
            updatedAt: Date.now(),
          });
        }
        
        // Check if QIP exists
        if (!qip || qip.qipNumber === 0n) {
          console.log(`[useQIP] ❌ QIP-${qipNumber} does not exist`);
          return null;
        }

        // Step 2: Get IPFS content (check cache first)
        const ipfsCacheKey = queryKeys.ipfs(qip.ipfsUrl);
        const cachedIPFS = queryClient.getQueryData<any>(ipfsCacheKey);
        
        let ipfsContent, frontmatter, content;
        
        if (cachedIPFS) {
          console.log(`[useQIP] ✓ Using cached IPFS content for QIP-${qipNumber}`, {
            cacheKeys: Object.keys(cachedIPFS),
            hasRaw: !!cachedIPFS.raw,
            hasBody: !!cachedIPFS.body,
            hasFrontmatter: !!cachedIPFS.frontmatter,
            rawLength: cachedIPFS.raw?.length,
            bodyLength: cachedIPFS.body?.length
          });
          
          // If we have already parsed content (from prefetch), use it directly
          // Check if this is a structured cache entry (has 'raw' field) with parsed data
          // Note: useQIPDataPaginated uses 'content' field, ProposalListItem uses 'body' field
          if (cachedIPFS.raw && cachedIPFS.frontmatter && ('body' in cachedIPFS || 'content' in cachedIPFS)) {
            console.log(`[useQIP] ✅ Using pre-parsed cached content for QIP-${qipNumber}`);
            frontmatter = cachedIPFS.frontmatter;
            // Handle both field names and ensure content is never undefined
            content = cachedIPFS.body || cachedIPFS.content || '';
          } else {
            // Otherwise, parse the raw content
            // If cachedIPFS.raw exists, use it; otherwise cachedIPFS itself is the raw content
            ipfsContent = cachedIPFS.raw || cachedIPFS;
            const parsed = ipfsService.parseQIPMarkdown(ipfsContent);
            
            frontmatter = parsed.frontmatter;
            content = parsed.content;
          }
          
        } else {
          console.log(`[useQIP] 🌐 Fetching IPFS content for QIP-${qipNumber} from ${qip.ipfsUrl}`);
          ipfsContent = await ipfsService.fetchQIP(qip.ipfsUrl);
          const parsed = ipfsService.parseQIPMarkdown(ipfsContent);
          
          frontmatter = parsed.frontmatter;
          content = parsed.content;
          
          // Cache IPFS content
          queryClient.setQueryData(ipfsCacheKey, {
            raw: ipfsContent,
            frontmatter,
            body: content,
            cid: qip.ipfsUrl,
          }, {
            updatedAt: Date.now(),
          });
        }
        
        // Step 3: Assemble the full QIP data
        const implDate = qip.implementationDate > 0n 
          ? new Date(Number(qip.implementationDate) * 1000).toISOString().split('T')[0]
          : 'None';
        
        const fullQIPData: QIPData = {
          qipNumber,
          title: qip.title,
          network: qip.network,
          status: qipClient.getStatusString(qip.status), // On-chain status (source of truth)
          statusEnum: qip.status, // Include the enum value
          ipfsStatus: frontmatter.status, // Status from IPFS (may differ)
          author: frontmatter.author || qip.author,
          implementor: qip.implementor,
          implementationDate: implDate,
          // Filter out TBU and other placeholders
          proposal: (qip.snapshotProposalId && 
                    qip.snapshotProposalId !== 'TBU' && 
                    qip.snapshotProposalId !== 'tbu' &&
                    qip.snapshotProposalId !== 'None') 
                    ? qip.snapshotProposalId 
                    : 'None',
          created: frontmatter.created || new Date(Number(qip.createdAt) * 1000).toISOString().split('T')[0],
          // Ensure content is never undefined - use empty string as fallback
          content: content || '',
          ipfsUrl: qip.ipfsUrl,
          contentHash: qip.contentHash,
          version: Number(qip.version),
          source: 'blockchain' as const,
          lastUpdated: Date.now()
        };

        
        console.log(`[useQIP] ✅ Assembled full QIP-${qipNumber} data`);
        return fullQIPData;
      } catch (error) {
        console.error(`[useQIP] ❌ Error fetching QIP ${qipNumber}:`, error);
        throw error;
      }
    },
    enabled: enabled && !!registryAddress && qipNumber > 0,
    staleTime: CACHE_TIMES.STALE_TIME.QIP_DETAIL, // 10 minutes
    gcTime: CACHE_TIMES.GC_TIME.QIP_DETAIL, // 1 hour
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    ...queryOptions,
  });
}