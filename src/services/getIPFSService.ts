import { config } from '../config/env';
import { 
  IPFSService, 
  PinataProvider, 
  LocalIPFSProvider, 
  MaiAPIProvider,
  type IPFSProvider 
} from './ipfsService';

/**
 * Get the appropriate IPFS provider based on environment configuration
 */
export function getIPFSProvider(): IPFSProvider {
  // Priority order:
  // 1. Mai API (if enabled and URL configured)
  // 2. Local IPFS (if enabled)
  // 3. Pinata (if JWT provided)
  // 4. Mai API fallback (if URL configured, even without explicit flag)
  
  console.log('🔍 IPFS Provider Selection Debug:', {
    useMaiApi: config.useMaiApi,
    ipfsApiUrl: config.ipfsApiUrl,
    useLocalIPFS: config.useLocalIPFS,
  });
  
  if (config.useMaiApi && config.ipfsApiUrl) {
    console.log('🌐 Using Mai API for IPFS uploads:', config.ipfsApiUrl);
    return new MaiAPIProvider(config.ipfsApiUrl);
  }
  
  if (config.useLocalIPFS) {
    console.log('🏠 Using local IPFS node');
    return new LocalIPFSProvider(
      config.localIPFSApi,
      config.localIPFSGateway
    );
  }
  
  // Fallback: If Mai API URL is configured, use it even without explicit flag
  if (config.ipfsApiUrl) {
    console.log('🌐 Using Mai API for IPFS uploads (fallback):', config.ipfsApiUrl);
    return new MaiAPIProvider(config.ipfsApiUrl);
  }
  
  throw new Error('No IPFS provider configured. Please set up Mai API, local IPFS, or Pinata.');
}

/**
 * Get a configured IPFS service instance
 */
export function getIPFSService(): IPFSService {
  const provider = getIPFSProvider();
  return new IPFSService(provider);
}

// Export a singleton instance for convenience
let ipfsServiceInstance: IPFSService | null = null;

export function getSharedIPFSService(): IPFSService {
  if (!ipfsServiceInstance) {
    ipfsServiceInstance = getIPFSService();
  }
  return ipfsServiceInstance;
}