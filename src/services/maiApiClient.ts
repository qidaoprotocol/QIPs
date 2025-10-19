/**
 * Mai API Client for fetching QCIs from the centralized API endpoint
 * This provides a much faster alternative to direct blockchain fetching
 * with built-in caching and IPFS content support
 */

import { QCIStatus } from './qciClient';

/**
 * QCI data as returned by the Mai API
 * Matches the format from /v3/qcis endpoint
 */
export interface MaiAPIQCI {
  qciNumber: number;
  author: string;
  title: string;
  chain: string;
  contentHash: string;
  ipfsUrl: string;
  createdAt: number;
  lastUpdated: number;
  status: string;
  statusCode: number;
  statusBytes32?: string; // bytes32 representation of status for v3 API
  implementor: string;
  implementationDate: number;
  snapshotProposalId: string;
  version: number;
  content?: string; // Optional IPFS content if requested
  contentError?: string; // Error if IPFS fetch failed
}

/**
 * Response format from the Mai API /v3/qcis endpoint
 */
export interface MaiAPIResponse {
  qcis: MaiAPIQCI[];
  totalCount: number;
  lastUpdated: number;
  chainId: number;
  contractAddress: string;
  cached: boolean;
  cacheTimestamp: number;
}

/**
 * Options for fetching QCIs from Mai API
 */
export interface FetchQCIsOptions {
  includeContent?: boolean; // Include IPFS content for ALL QCIs (slow)
  contentFor?: number[]; // Include IPFS content for specific QCI numbers
  forceRefresh?: boolean; // Bypass cache and fetch fresh data
  mockMode?: boolean; // Use mock data for testing (dev only)
}

/**
 * Mai API Client for QCI data
 */
export class MaiAPIClient {
  private readonly baseUrl: string;
  private defaultTimeout: number = 30000; // 30 seconds

  constructor(baseUrl: string = 'https://api.mai.finance') {
    this.baseUrl = baseUrl;
  }
  
  /**
   * Get the base URL for this client
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Fetch all QCIs from the Mai API
   * Starting from QCI 209 (first QCI in registry) to latest
   */
  async fetchQCIs(options: FetchQCIsOptions = {}): Promise<MaiAPIResponse> {
    const params = new URLSearchParams();

    if (options.includeContent) {
      params.append('includeContent', 'true');
    }

    if (options.contentFor && options.contentFor.length > 0) {
      params.append('contentFor', options.contentFor.join(','));
    }

    if (options.forceRefresh) {
      params.append('forceRefresh', 'true');
    }

    if (options.mockMode) {
      params.append('mockMode', 'true');
    }

    const url = `${this.baseUrl}/v3/qcis${params.toString() ? `?${params}` : ''}`;

    console.log('[MaiAPIClient] Fetching QCIs from:', url);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(this.defaultTimeout),
      });

      if (!response.ok) {
        throw new Error(`Mai API request failed: ${response.status} ${response.statusText}`);
      }

      const data: MaiAPIResponse = await response.json();

      console.log(`[MaiAPIClient] Received ${data.qcis.length} QCIs (cached: ${data.cached})`);

      // Validate that QCIs start from 209 as expected
      if (data.qcis.length > 0) {
        const minQipNumber = Math.min(...data.qcis.map(q => q.qciNumber));
        if (minQipNumber < 209) {
          console.warn(`[MaiAPIClient] Warning: Found QCI ${minQipNumber} which is below expected minimum of 209`);
        }
      }

      return data;
    } catch (error: any) {
      console.error('[MaiAPIClient] Error fetching QCIs:', error);
      throw error;
    }
  }

  /**
   * Fetch a specific QCI with its content
   */
  async fetchQCI(qciNumber: number): Promise<MaiAPIQCI | null> {
    const response = await this.fetchQCIs({
      contentFor: [qciNumber],
    });

    const qci = response.qcis.find(q => q.qciNumber === qciNumber);
    return qci || null;
  }

  /**
   * Get QCIs by status
   */
  async getQCIsByStatus(status: QCIStatus): Promise<MaiAPIQCI[]> {
    const response = await this.fetchQCIs();
    return response.qcis.filter(q => q.statusCode === status);
  }

  /**
   * Convert Mai API status string to status ID
   */
  static statusStringToId(status: string): QCIStatus {
    // Map old status strings to new 3-status system
    const statusMap: Record<string, number> = {
      'Draft': 0,
      'ReviewPending': 1, // Maps to Ready for Snapshot
      'Review': 1, // Maps to Ready for Snapshot
      'VotePending': 2, // Maps to Posted to Snapshot
      'Vote': 2, // Maps to Posted to Snapshot
      'Approved': 2, // Historical - maps to Posted
      'Rejected': 2, // Historical - maps to Posted
      'Implemented': 2, // Historical - maps to Posted
      'Superseded': 2, // Historical - maps to Posted
      'Withdrawn': 2, // Historical - maps to Posted
    };

    return statusMap[status] ?? 2; // Default to Posted for historical
  }

  /**
   * Convert status ID to display string (fallback when contract not available)
   */
  static statusIdToDisplay(status: QCIStatus): string {
    const statusMap: Record<number, string> = {
      0: 'Draft',
      1: 'Ready for Snapshot',
      2: 'Posted to Snapshot',
      3: 'Archived',
      4: 'Implemented'
    };

    return statusMap[status] || `Status ${status}`;
  }

  /**
   * Convert Mai API QCI to app's QCIData format
   */
  static toQCIData(apiQip: MaiAPIQCI): any {
    // Convert implementation date
    const implDate = apiQip.implementationDate > 0
      ? new Date(apiQip.implementationDate * 1000).toISOString().split('T')[0]
      : 'None';

    // Convert created date
    const created = apiQip.createdAt > 0
      ? new Date(apiQip.createdAt * 1000).toISOString().split('T')[0]
      : 'None';

    // Process proposal URL - extract just the proposal ID if it's a full URL
    let proposalId = 'None';
    if (apiQip.snapshotProposalId && 
        apiQip.snapshotProposalId !== '' &&
        apiQip.snapshotProposalId !== 'None' &&
        apiQip.snapshotProposalId !== 'N/A' &&
        apiQip.snapshotProposalId !== 'TBU' &&
        apiQip.snapshotProposalId !== 'tbu') {
      // If it's a full URL, extract the proposal ID
      const match = apiQip.snapshotProposalId.match(/proposal\/(0x[a-fA-F0-9]+)/);
      proposalId = match ? match[1] : apiQip.snapshotProposalId;
    }

    // Format author - if it's an address, shorten it, otherwise use as-is
    let authorDisplay = apiQip.author;
    if (authorDisplay && authorDisplay.startsWith('0x')) {
      // Check if it's the common author address
      if (authorDisplay.toLowerCase() === '0x0000000000000000000000000000000000000001') {
        authorDisplay = 'QiDao Team';
      } else {
        // Shorten address: 0x1234...5678
        authorDisplay = `${authorDisplay.slice(0, 6)}...${authorDisplay.slice(-4)}`;
      }
    }

    return {
      qciNumber: apiQip.qciNumber,
      title: apiQip.title,
      chain: apiQip.chain,
      status: MaiAPIClient.statusIdToDisplay(apiQip.statusCode as QCIStatus),
      statusEnum: apiQip.statusCode as QCIStatus,
      author: authorDisplay,
      authorAddress: apiQip.author, // Keep original address for reference
      implementor: apiQip.implementor || 'None',
      implementationDate: implDate,
      proposal: proposalId,
      created,
      content: apiQip.content || '',
      ipfsUrl: apiQip.ipfsUrl,
      contentHash: apiQip.contentHash,
      version: apiQip.version,
      source: 'api' as const,
      lastUpdated: apiQip.lastUpdated * 1000, // Convert to milliseconds
      // Include the full snapshot URL for reference if needed
      snapshotProposalUrl: apiQip.snapshotProposalId
    };
  }
}

/**
 * Singleton instance for convenience
 */
let maiApiClient: MaiAPIClient | null = null;

export function getMaiAPIClient(baseUrl?: string): MaiAPIClient {
  if (!maiApiClient || (baseUrl && maiApiClient.getBaseUrl() !== baseUrl)) {
    maiApiClient = new MaiAPIClient(baseUrl);
  }
  return maiApiClient;
}