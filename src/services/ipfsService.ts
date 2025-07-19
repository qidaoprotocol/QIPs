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
  
  constructor(apiUrl: string = 'http://localhost:5001', _gatewayUrl?: string) {
    this.apiUrl = apiUrl;
    // gatewayUrl is not used anymore as we fetch via API
  }

  async upload(content: string | Blob): Promise<string> {
    const formData = new FormData();
    const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/plain' });
    formData.append('file', blob);
    
    const response = await fetch(`${this.apiUrl}/api/v0/add`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Local IPFS upload failed: ${response.statusText}. Ensure IPFS daemon is running at ${this.apiUrl}`);
    }

    const result = await response.json();
    return result.Hash;
  }

  async fetch(cid: string): Promise<string> {
    // Use the API endpoint for fetching content in local development
    const response = await fetch(`${this.apiUrl}/api/v0/cat?arg=${cid}`, {
      method: 'POST'
    });
    if (!response.ok) {
      throw new Error(`Local IPFS fetch failed: ${response.statusText}. Ensure IPFS daemon is running at ${this.apiUrl}`);
    }
    return response.text();
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
   * Upload QIP content to IPFS from structured data
   */
  async uploadQIPFromContent(qipContent: QIPContent): Promise<{
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
   * Upload pre-formatted QIP markdown content with metadata
   */
  async uploadQIP(markdownContent: string, metadata?: {
    name?: string;
    qipNumber?: string;
    title?: string;
    author?: string;
    version?: string;
  }): Promise<string> {
    // Upload to IPFS
    const cid = await this.provider.upload(markdownContent);
    return `ipfs://${cid}`;
  }

  /**
   * Generate QIP markdown from frontmatter and content
   */
  generateQIPMarkdown(frontmatter: Record<string, any>, content: string): string {
    const frontmatterLines = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    
    return `---\n${frontmatterLines}\n---\n\n${content}`;
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