import type { Hash } from 'viem';
import { keccak256, toBytes } from 'viem';
import type { QIPContent } from './qipClient';

/**
 * Interface for IPFS storage providers
 */
export interface IPFSProvider {
  upload(content: string | Blob): Promise<string>;
  fetch(cid: string): Promise<string>;
}

/**
 * Web3.Storage implementation
 */
export class Web3StorageProvider implements IPFSProvider {
  private token: string;
  
  constructor(token: string) {
    this.token = token;
  }

  async upload(content: string | Blob): Promise<string> {
    const blob = content instanceof Blob ? content : new Blob([content]);
    
    const response = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      body: blob
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const { cid } = await response.json();
    return cid;
  }

  async fetch(cid: string): Promise<string> {
    const response = await fetch(`https://w3s.link/ipfs/${cid}`);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.statusText}`);
    }
    return response.text();
  }
}


/**
 * Local IPFS implementation for development
 */
export class LocalIPFSProvider implements IPFSProvider {
  private apiUrl: string;
  private gatewayUrl: string;
  
  constructor(apiUrl: string = 'http://localhost:5001', gatewayUrl: string = 'http://localhost:8080') {
    this.apiUrl = apiUrl;
    this.gatewayUrl = gatewayUrl;
    LocalIPFSProvider.initializeMockData();
  }

  async upload(content: string | Blob): Promise<string> {
    const formData = new FormData();
    const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/plain' });
    formData.append('file', blob);
    
    try {
      const response = await fetch(`${this.apiUrl}/api/v0/add`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Local IPFS upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result.Hash;
    } catch (error) {
      // Fallback to in-memory storage for pure local development
      console.warn('Local IPFS daemon not running, using in-memory storage');
      return this.mockUpload(content);
    }
  }

  async fetch(cid: string): Promise<string> {
    try {
      const response = await fetch(`${this.gatewayUrl}/ipfs/${cid}`);
      if (!response.ok) {
        throw new Error(`Local IPFS fetch failed: ${response.statusText}`);
      }
      return response.text();
    } catch (error) {
      // Fallback to in-memory storage
      console.warn('Local IPFS daemon not running, using in-memory storage');
      return this.mockFetch(cid);
    }
  }

  // In-memory storage for when IPFS daemon is not running
  private static mockStorage = new Map<string, string>();
  private static initialized = false;

  private static initializeMockData() {
    if (LocalIPFSProvider.initialized) return;
    
    // Initialize mock storage with test data
    const testQIPs = [
      {
        cid: 'QmTest249DynamicRates',
        content: `---
qip: 249
title: Implement Dynamic Interest Rates
network: Polygon
status: Draft
author: AUTHOR1
implementor: None
implementation-date: None
proposal: None
created: 2025-01-15
---

## Summary

This proposal implements dynamic interest rates for QiDAO vaults.

## Motivation

To improve capital efficiency and maintain MAI peg stability.

## Specification

Dynamic rates will adjust based on utilization and market conditions.`
      },
      {
        cid: 'QmTest249DynamicRatesV2',
        content: `---
qip: 249
title: Implement Dynamic Interest Rates (Revised)
network: Polygon
status: Review
author: AUTHOR1
implementor: Core Team
implementation-date: 2025-02-15
proposal: snapshot.org/#/qidao.eth/proposal/0x249test
created: 2025-01-15
---

## Summary

This revised proposal implements dynamic interest rates for QiDAO vaults with more detailed implementation specs.

## Motivation

To improve capital efficiency and maintain MAI peg stability.

## Specification

Dynamic rates will adjust based on utilization and market conditions.
Added more detailed implementation specs.`
      },
      {
        cid: 'QmTest250MultiCollateral',
        content: `---
qip: 250
title: Add Support for New Collateral Types
network: Base
status: ReviewPending
author: AUTHOR2
implementor: None
implementation-date: None
proposal: None
created: 2025-01-15
---

## Summary

Add support for multiple new collateral types.

## Motivation

Expand collateral options for users.`
      },
      {
        cid: 'QmTest251StakingRewards',
        content: `---
qip: 251
title: Governance Token Staking Rewards
network: Ethereum
status: Withdrawn
author: AUTHOR3
implementor: None
implementation-date: None
proposal: None
created: 2025-01-15
---

## Summary

Implement staking rewards for governance token holders.

## Motivation

Incentivize long-term holding.`
      },
      {
        cid: 'QmHistorical100',
        content: `---
qip: 100
title: Historical: Protocol Launch
network: Polygon
status: Implemented
author: Core Team
implementor: Core Team
implementation-date: 2022-01-01
proposal: snapshot.org/#/qidao.eth/proposal/0x100
created: 2022-01-01
---

## Summary

Initial protocol launch on Polygon.`
      },
      {
        cid: 'QmHistorical150',
        content: `---
qip: 150
title: Historical: Rejected Proposal
network: Ethereum
status: Rejected
author: Community Member
implementor: None
implementation-date: None
proposal: snapshot.org/#/qidao.eth/proposal/0x150
created: 2022-04-27
---

## Summary

A proposal that was rejected by governance.`
      },
      {
        cid: 'QmHistorical200',
        content: `---
qip: 200
title: Historical: Superseded Protocol Update
network: Base
status: Superseded
author: Core Team
implementor: Core Team
implementation-date: 2022-11-15
proposal: snapshot.org/#/qidao.eth/proposal/0x200
created: 2022-11-01
---

## Summary

A protocol update that was later superseded.`
      },
      {
        cid: 'Qmf14mfFZQCUR4eC467YjDpaZFCNookdLN89ceSNnjpTF8',
        content: `---
qip: 249
title: test
network: Polygon
status: Draft
author: 0x742d35Cc6634C0532925a3b8D4C9db96590c6C8C
implementor: None
implementation-date: None
proposal: None
created: ${new Date().toISOString().split('T')[0]}
---

## Summary

This is a test QIP created during development.

## Motivation

Testing the QIP creation and display functionality.`
      },
      {
        cid: 'QmV9d2ufygH8KEXXkyWo9rX4JGXh53HRLHRHpp26vQ7kNA',
        content: `---
qip: 250
title: Another Test QIP
network: Base
status: Draft
author: 0x742d35Cc6634C0532925a3b8D4C9db96590c6C8C
implementor: None
implementation-date: None
proposal: None
created: ${new Date().toISOString().split('T')[0]}
---

## Summary

This is another test QIP to verify dynamic routing works.

## Motivation

Testing that newly created QIPs can be viewed immediately without rebuilding.`
      }
    ];

    // Add test data to mock storage
    testQIPs.forEach(({ cid, content }) => {
      LocalIPFSProvider.mockStorage.set(cid, content);
    });
    console.log('Mock IPFS: Initialized with test data');
    LocalIPFSProvider.initialized = true;
  }

  private mockUpload(content: string | Blob): string {
    const contentStr = content instanceof Blob ? 'blob-content' : content;
    const mockCid = `Qm${Math.random().toString(36).substring(2, 15)}`;
    LocalIPFSProvider.mockStorage.set(mockCid, contentStr);
    console.log(`Mock IPFS: Stored content with CID ${mockCid}`);
    return mockCid;
  }

  private mockFetch(cid: string): string {
    const content = LocalIPFSProvider.mockStorage.get(cid);
    if (!content) {
      throw new Error(`Mock IPFS: Content not found for CID ${cid}`);
    }
    return content;
  }
}

/**
 * Pinata implementation
 */
export class PinataProvider implements IPFSProvider {
  private jwt: string;
  private gateway: string;
  
  constructor(jwt: string, gateway: string = 'https://gateway.pinata.cloud') {
    this.jwt = jwt;
    this.gateway = gateway;
  }

  async upload(content: string | Blob): Promise<string> {
    // If content is a string, try to parse it as JSON for more efficient upload
    if (typeof content === 'string') {
      try {
        const jsonData = JSON.parse(content);
        return await this.uploadJSON(jsonData);
      } catch {
        // Not valid JSON, upload as file
        return await this.uploadFile(content);
      }
    }
    
    // Blob content, upload as file
    return await this.uploadFile(content);
  }

  private async uploadJSON(data: any): Promise<string> {
    const body = {
      pinataContent: data,
      pinataOptions: {
        cidVersion: 1
      },
      pinataMetadata: {
        name: `QIP-${data.qip || 'draft'}.json`,
        keyvalues: {
          type: 'qip-proposal',
          qip: String(data.qip || 'draft'),
          network: data.network || 'unknown'
        }
      }
    };

    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.jwt}`,
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata JSON upload failed: ${response.statusText} - ${errorText}`);
    }

    const { IpfsHash } = await response.json();
    return IpfsHash;
  }

  private async uploadFile(content: string | Blob): Promise<string> {
    const formData = new FormData();
    const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/plain' });
    
    // Generate a filename based on content
    const filename = content instanceof Blob ? 'file.txt' : 'qip-content.md';
    formData.append('file', blob, filename);
    
    // Add pinata metadata
    const metadata = JSON.stringify({
      name: filename,
      keyvalues: {
        type: 'qip-content'
      }
    });
    formData.append('pinataMetadata', metadata);
    
    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.jwt}`,
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata file upload failed: ${response.statusText} - ${errorText}`);
    }

    const { IpfsHash } = await response.json();
    return IpfsHash;
  }

  async fetch(cid: string): Promise<string> {
    const response = await fetch(`${this.gateway}/ipfs/${cid}`);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.statusText}`);
    }
    return response.text();
  }
}

/**
 * Main IPFS service for managing QIPs
 */
export class IPFSService {
  private provider: IPFSProvider;

  constructor(provider: IPFSProvider) {
    this.provider = provider;
  }

  /**
   * Upload QIP content to IPFS
   */
  async uploadQIP(qipContent: QIPContent): Promise<{
    cid: string;
    ipfsUrl: string;
    contentHash: Hash;
  }> {
    // Format as markdown with YAML frontmatter
    const fullContent = this.formatQIPContent(qipContent);
    
    // Calculate content hash including title, author, timestamp, and content to ensure uniqueness
    const uniqueContent = JSON.stringify({
      title: qipContent.title,
      author: qipContent.author,
      content: qipContent.content,
      created: qipContent.created,
      timestamp: Date.now()
    });
    const contentHash = keccak256(toBytes(uniqueContent));
    
    // Upload to IPFS
    const cid = await this.provider.upload(fullContent);
    const ipfsUrl = `ipfs://${cid}`;
    
    return {
      cid,
      ipfsUrl,
      contentHash
    };
  }

  /**
   * Format QIP content with YAML frontmatter
   */
  private formatQIPContent(qipData: QIPContent): string {
    return `---
qip: ${qipData.qip}
title: ${qipData.title}
network: ${qipData.network}
status: ${qipData.status}
author: ${qipData.author}
implementor: ${qipData.implementor}
implementation-date: ${qipData['implementation-date']}
proposal: ${qipData.proposal}
created: ${qipData.created}
---

${qipData.content}`;
  }

  /**
   * Upload raw markdown content
   */
  async uploadRawContent(content: string): Promise<{
    cid: string;
    ipfsUrl: string;
    contentHash: Hash;
  }> {
    // Calculate content hash
    const contentHash = keccak256(toBytes(content));
    
    // Upload to IPFS
    const cid = await this.provider.upload(content);
    const ipfsUrl = `ipfs://${cid}`;
    
    return {
      cid,
      ipfsUrl,
      contentHash
    };
  }

  /**
   * Fetch and parse QIP from IPFS
   */
  async fetchQIP(cidOrUrl: string): Promise<string> {
    // Extract CID from URL if needed
    const cid = cidOrUrl.startsWith('ipfs://') 
      ? cidOrUrl.slice(7) 
      : cidOrUrl;
    
    return await this.provider.fetch(cid);
  }

  /**
   * Parse QIP markdown to extract frontmatter and content
   */
  parseQIPMarkdown(markdown: string): {
    frontmatter: Record<string, any>;
    content: string;
  } {
    const match = markdown.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
    
    if (!match) {
      throw new Error('Invalid QIP format: missing frontmatter');
    }
    
    const yamlContent = match[1];
    const content = match[2].trim();
    
    // Simple YAML parsing
    const frontmatter: Record<string, any> = {};
    const lines = yamlContent.split('\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        frontmatter[key] = value;
      }
    }
    
    return { frontmatter, content };
  }

  /**
   * Verify QIP content matches hash
   */
  verifyContentHash(content: string, expectedHash: Hash): boolean {
    const actualHash = keccak256(toBytes(content));
    return actualHash === expectedHash;
  }

  /**
   * Get gateway URL for a CID
   */
  getGatewayUrl(cidOrUrl: string): string {
    const cid = cidOrUrl.startsWith('ipfs://') 
      ? cidOrUrl.slice(7) 
      : cidOrUrl;
    
    if (this.provider instanceof Web3StorageProvider) {
      return `https://w3s.link/ipfs/${cid}`;
    } else if (this.provider instanceof PinataProvider) {
      return `https://gateway.pinata.cloud/ipfs/${cid}`;
    } else if (this.provider instanceof LocalIPFSProvider) {
      return `http://localhost:8080/ipfs/${cid}`;
    }
    
    // Default gateway
    return `https://ipfs.io/ipfs/${cid}`;
  }

  /**
   * Upload JSON data to IPFS
   */
  async uploadJSON(data: any): Promise<string> {
    const json = JSON.stringify(data, null, 2);
    return await this.provider.upload(json);
  }

  /**
   * Fetch and parse JSON from IPFS
   */
  async fetchJSON<T = any>(cidOrUrl: string): Promise<T> {
    const content = await this.fetchQIP(cidOrUrl);
    return JSON.parse(content);
  }
}