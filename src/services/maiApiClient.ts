/**
 * Mai API Client for fetching QIPs from the centralized API endpoint
 * This provides a much faster alternative to direct blockchain fetching
 * with built-in caching and IPFS content support
 */

import { QIPStatus } from './qipClient';

/**
 * QIP data as returned by the Mai API
 * Matches the format from /v2/qips endpoint
 */
export interface MaiAPIQIP {
  qipNumber: number;
  author: string;
  title: string;
  network: string;
  contentHash: string;
  ipfsUrl: string;
  createdAt: number;
  lastUpdated: number;
  status: string;
  statusCode: number;
  implementor: string;
  implementationDate: number;
  snapshotProposalId: string;
  version: number;
  content?: string; // Optional IPFS content if requested
  contentError?: string; // Error if IPFS fetch failed
}

/**
 * Response format from the Mai API /v2/qips endpoint
 */
export interface MaiAPIResponse {
  qips: MaiAPIQIP[];
  totalCount: number;
  lastUpdated: number;
  chainId: number;
  contractAddress: string;
  cached: boolean;
  cacheTimestamp: number;
}

/**
 * Options for fetching QIPs from Mai API
 */
export interface FetchQIPsOptions {
  includeContent?: boolean; // Include IPFS content for ALL QIPs (slow)
  contentFor?: number[]; // Include IPFS content for specific QIP numbers
  forceRefresh?: boolean; // Bypass cache and fetch fresh data
  mockMode?: boolean; // Use mock data for testing (dev only)
}

/**
 * Mai API Client for QIP data
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
   * Fetch all QIPs from the Mai API
   * Starting from QIP 209 (first QIP in registry) to latest
   */
  async fetchQIPs(options: FetchQIPsOptions = {}): Promise<MaiAPIResponse> {
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

    const url = `${this.baseUrl}/v2/qips${params.toString() ? `?${params}` : ''}`;

    console.log('[MaiAPIClient] Fetching QIPs from:', url);

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

      console.log(`[MaiAPIClient] Received ${data.qips.length} QIPs (cached: ${data.cached})`);

      // Validate that QIPs start from 209 as expected
      if (data.qips.length > 0) {
        const minQipNumber = Math.min(...data.qips.map(q => q.qipNumber));
        if (minQipNumber < 209) {
          console.warn(`[MaiAPIClient] Warning: Found QIP ${minQipNumber} which is below expected minimum of 209`);
        }
      }

      return data;
    } catch (error: any) {
      console.error('[MaiAPIClient] Error fetching QIPs:', error);
      throw error;
    }
  }

  /**
   * Fetch a specific QIP with its content
   */
  async fetchQIP(qipNumber: number): Promise<MaiAPIQIP | null> {
    const response = await this.fetchQIPs({
      contentFor: [qipNumber],
    });

    const qip = response.qips.find(q => q.qipNumber === qipNumber);
    return qip || null;
  }

  /**
   * Get QIPs by status
   */
  async getQIPsByStatus(status: QIPStatus): Promise<MaiAPIQIP[]> {
    const response = await this.fetchQIPs();
    return response.qips.filter(q => q.statusCode === status);
  }

  /**
   * Convert Mai API status string to QIPStatus enum
   */
  static statusStringToEnum(status: string): QIPStatus {
    const statusMap: Record<string, QIPStatus> = {
      'Draft': QIPStatus.Draft,
      'ReviewPending': QIPStatus.ReviewPending,
      'VotePending': QIPStatus.VotePending,
      'Approved': QIPStatus.Approved,
      'Rejected': QIPStatus.Rejected,
      'Implemented': QIPStatus.Implemented,
      'Superseded': QIPStatus.Superseded,
      'Withdrawn': QIPStatus.Withdrawn,
    };

    return statusMap[status] ?? QIPStatus.Draft;
  }

  /**
   * Convert QIPStatus enum to display string
   */
  static statusEnumToDisplay(status: QIPStatus): string {
    const statusMap = {
      [QIPStatus.Draft]: 'Draft',
      [QIPStatus.ReviewPending]: 'Review',
      [QIPStatus.VotePending]: 'Vote',
      [QIPStatus.Approved]: 'Approved',
      [QIPStatus.Rejected]: 'Rejected',
      [QIPStatus.Implemented]: 'Implemented',
      [QIPStatus.Superseded]: 'Superseded',
      [QIPStatus.Withdrawn]: 'Withdrawn',
    };

    return statusMap[status] || 'Unknown';
  }

  /**
   * Convert Mai API QIP to app's QIPData format
   */
  static toQIPData(apiQip: MaiAPIQIP): any {
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
      qipNumber: apiQip.qipNumber,
      title: apiQip.title,
      network: apiQip.network,
      status: MaiAPIClient.statusEnumToDisplay(apiQip.statusCode as QIPStatus),
      statusEnum: apiQip.statusCode as QIPStatus,
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