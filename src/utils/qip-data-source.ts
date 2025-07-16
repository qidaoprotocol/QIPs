import { createPublicClient, http, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { QIPClient, QIPStatus } from '../services/qipClient';
import { IPFSService, PinataProvider, LocalIPFSProvider } from '../services/ipfsService';

export interface QIPData {
  qipNumber: number;
  title: string;
  network: string;
  status: string;
  author: string;
  implementor: string;
  implementationDate: string;
  proposal: string;
  created: string;
  content: string;
  ipfsUrl: string;
  contentHash: string;
  version: number;
}

export class QIPDataSource {
  private qipClient: QIPClient;
  private ipfsService: IPFSService;
  private cache: Map<number, QIPData> = new Map();

  constructor(
    registryAddress: Address,
    pinataJwt: string,
    pinataGateway: string = 'https://gateway.pinata.cloud',
    rpcUrl?: string,
    testnet: boolean = false,
    useLocalIPFS: boolean = false,
    localIPFSApi: string = 'http://localhost:5001',
    localIPFSGateway: string = 'http://localhost:8080'
  ) {
    this.qipClient = new QIPClient(registryAddress, rpcUrl, testnet);
    
    // Use LocalIPFSProvider if in local mode, otherwise use Pinata
    if (useLocalIPFS) {
      this.ipfsService = new IPFSService(new LocalIPFSProvider(localIPFSApi, localIPFSGateway));
    } else {
      this.ipfsService = new IPFSService(new PinataProvider(pinataJwt, pinataGateway));
    }
  }

  /**
   * Fetch all QIPs from the blockchain and IPFS
   */
  async fetchAllQIPs(): Promise<QIPData[]> {
    const qips: QIPData[] = [];
    
    // Get QIPs by status
    const statuses = [
      QIPStatus.Draft,
      QIPStatus.ReviewPending,
      QIPStatus.VotePending,
      QIPStatus.Approved,
      QIPStatus.Rejected,
      QIPStatus.Implemented
    ];

    for (const status of statuses) {
      const qipNumbers = await this.qipClient.getQIPsByStatus(status);
      
      for (const qipNumber of qipNumbers) {
        try {
          const qipData = await this.fetchQIP(Number(qipNumber));
          if (qipData) {
            qips.push(qipData);
          }
        } catch (error) {
          console.error(`Error fetching QIP ${qipNumber}:`, error);
        }
      }
    }

    return qips;
  }

  /**
   * Fetch a single QIP
   */
  async fetchQIP(qipNumber: number): Promise<QIPData | null> {
    // Check cache first
    if (this.cache.has(qipNumber)) {
      return this.cache.get(qipNumber)!;
    }

    try {
      // Get on-chain data
      const qip = await this.qipClient.getQIP(BigInt(qipNumber));
      
      // Fetch content from IPFS
      const ipfsContent = await this.ipfsService.fetchQIP(qip.ipfsUrl);
      const { frontmatter, content } = this.ipfsService.parseQIPMarkdown(ipfsContent);
      
      // Convert implementation date
      const implDate = qip.implementationDate > 0n 
        ? new Date(Number(qip.implementationDate) * 1000).toISOString().split('T')[0]
        : 'None';
      
      const qipData: QIPData = {
        qipNumber,
        title: qip.title,
        network: qip.network,
        status: this.qipClient.getStatusString(qip.status),
        author: frontmatter.author || qip.author,
        implementor: qip.implementor,
        implementationDate: implDate,
        proposal: qip.snapshotProposalId || 'None',
        created: frontmatter.created || new Date(Number(qip.createdAt) * 1000).toISOString().split('T')[0],
        content,
        ipfsUrl: qip.ipfsUrl,
        contentHash: qip.contentHash,
        version: Number(qip.version)
      };
      
      // Cache the result
      this.cache.set(qipNumber, qipData);
      
      return qipData;
    } catch (error) {
      console.error(`Failed to fetch QIP ${qipNumber}:`, error);
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Watch for new QIPs and update cache
   */
  watchNewQIPs(callback: (qip: QIPData) => void) {
    return this.qipClient.watchQIPs(async (event) => {
      const qipData = await this.fetchQIP(Number(event.qipNumber));
      if (qipData) {
        callback(qipData);
      }
    });
  }
}

/**
 * Gatsby source node helper
 */
export async function sourceQIPsFromChain(
  registryAddress: Address,
  pinataJwt: string,
  pinataGateway: string = 'https://gateway.pinata.cloud',
  rpcUrl?: string,
  testnet: boolean = false,
  useLocalIPFS: boolean = false,
  localIPFSApi: string = 'http://localhost:5001',
  localIPFSGateway: string = 'http://localhost:8080'
): Promise<QIPData[]> {
  const dataSource = new QIPDataSource(
    registryAddress, 
    pinataJwt, 
    pinataGateway, 
    rpcUrl, 
    testnet,
    useLocalIPFS,
    localIPFSApi,
    localIPFSGateway
  );
  return await dataSource.fetchAllQIPs();
}