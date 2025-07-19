import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { QIPClient } from '../services/qipClient';

interface QIPVersion {
  version: number;
  ipfsUrl: string;
  updatedAt: string;
  author: string;
}

interface UseQIPVersionHistoryOptions {
  registryAddress: `0x${string}`;
  qipNumber: number;
  enabled?: boolean;
  queryOptions?: Omit<UseQueryOptions<QIPVersion[]>, 'queryKey' | 'queryFn'>;
}

/**
 * Hook to fetch version history for a QIP
 */
export function useQIPVersionHistory({
  registryAddress,
  qipNumber,
  enabled = true,
  queryOptions = {},
}: UseQIPVersionHistoryOptions) {
  const qipClient = new QIPClient(registryAddress, 'http://localhost:8545', false);

  return useQuery<QIPVersion[]>({
    queryKey: ['qip', 'versions', qipNumber, registryAddress],
    queryFn: async () => {
      if (!qipClient || qipNumber <= 0) return [];

      try {
        const qip = await qipClient.getQIP(BigInt(qipNumber));
        
        if (!qip || qip.qipNumber === 0n) {
          return [];
        }

        // For now, we only have the current version
        // In the future, this could fetch from event logs or a separate version tracking system
        const versions: QIPVersion[] = [{
          version: Number(qip.version),
          ipfsUrl: qip.ipfsUrl,
          updatedAt: new Date(Number(qip.lastUpdatedAt) * 1000).toISOString(),
          author: qip.author,
        }];

        // TODO: Fetch historical versions from blockchain events
        // This would involve querying QIPUpdated events for this QIP number

        return versions;
      } catch (error) {
        console.error(`Error fetching version history for QIP ${qipNumber}:`, error);
        throw error;
      }
    },
    enabled: enabled && !!registryAddress && qipNumber > 0,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 10 * 60 * 1000, // 10 minutes
    ...queryOptions,
  });
}