import { useQuery, UseQueryOptions, useQueryClient } from '@tanstack/react-query';
import { QIPClient } from '../services/qipClient';
import { getIPFSService } from '../services/getIPFSService';
import { QIPData } from './useQIPData';
import { config } from '../config/env';
import { CACHE_TIMES } from '../config/queryClient';
import { useCachedIPFS } from './useCachedIPFS';

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
    queryKey: ['qip', qipNumber, registryAddress],
    queryFn: async () => {
      if (!qipClient || qipNumber <= 0) return null;

      try {
        // Step 1: Check if we have cached blockchain data
        const cachedQIPData = queryClient.getQueryData<any>(['qip-blockchain', qipNumber, registryAddress]);
        
        let qip;
        if (cachedQIPData) {
          console.debug(`[useQIP] Using cached blockchain data for QIP ${qipNumber}`);
          qip = cachedQIPData;
        } else {
          // Fetch from blockchain
          qip = await qipClient.getQIP(BigInt(qipNumber));
          
          // Cache the blockchain data separately
          queryClient.setQueryData(['qip-blockchain', qipNumber, registryAddress], qip, {
            updatedAt: Date.now(),
          });
        }
        
        // Check if QIP exists
        if (!qip || qip.qipNumber === 0n) {
          return null;
        }

        // Step 2: Check for cached IPFS content
        const ipfsCacheKey = ['ipfs', qip.ipfsUrl];
        const cachedIPFS = queryClient.getQueryData<any>(ipfsCacheKey);
        
        let ipfsContent, frontmatter, content;
        
        if (cachedIPFS) {
          console.debug(`[useQIP] Using cached IPFS content for CID: ${qip.ipfsUrl}`);
          ipfsContent = cachedIPFS.raw || cachedIPFS;
          const parsed = ipfsService.parseQIPMarkdown(ipfsContent);
          frontmatter = parsed.frontmatter;
          content = parsed.content;
        } else {
          // Fetch from IPFS
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
        
        const implDate = qip.implementationDate > 0n 
          ? new Date(Number(qip.implementationDate) * 1000).toISOString().split('T')[0]
          : 'None';
        
        return {
          qipNumber,
          title: qip.title,
          network: qip.network,
          status: qipClient.getStatusString(qip.status),
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
          content,
          ipfsUrl: qip.ipfsUrl,
          contentHash: qip.contentHash,
          version: Number(qip.version),
          source: 'blockchain' as const,
          lastUpdated: Date.now()
        };
      } catch (error) {
        console.error(`Error fetching QIP ${qipNumber}:`, error);
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