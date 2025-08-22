import { config } from '../config/env';
import { 
  IPFSService, 
  PinataProvider, 
  LocalIPFSProvider, 
  MaiAPIProvider,
  type IPFSProvider,
  IPFS_GATEWAYS
} from './ipfsService';

/**
 * Get configured IPFS gateways from environment or use defaults
 */
function getConfiguredGateways(): string[] {
  // Check for multiple gateways configuration
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_IPFS_GATEWAYS) {
    const gateways = import.meta.env.VITE_IPFS_GATEWAYS;
    if (typeof gateways === 'string') {
      return gateways.split(',').map(url => url.trim()).filter(Boolean);
    }
  }
  
  // Check for single gateway and add to defaults
  if (config.pinataGateway && !IPFS_GATEWAYS.includes(config.pinataGateway)) {
    return [config.pinataGateway, ...IPFS_GATEWAYS];
  }
  
  return IPFS_GATEWAYS;
}

/**
 * Get the appropriate IPFS provider based on environment configuration
 */
export function getIPFSProvider(): IPFSProvider {
  // Priority order:
  // 1. Local IPFS (if in local mode OR explicitly enabled)
  // 2. Mai API (if enabled and URL configured)
  // 3. Pinata (if JWT provided)
  // 4. Mai API fallback (if URL configured, even without explicit flag)
  
  console.log('🔍 IPFS Provider Selection Debug:', {
    localMode: config.localMode,
    useMaiApi: config.useMaiApi,
    ipfsApiUrl: config.ipfsApiUrl,
    useLocalIPFS: config.useLocalIPFS,
  });
  
  // Get configured gateways
  const gateways = getConfiguredGateways();
  
  // In local mode, always use local IPFS
  if (config.localMode || config.useLocalIPFS) {
    console.log('🏠 Using local IPFS node (localMode:', config.localMode, ', useLocalIPFS:', config.useLocalIPFS, ')');
    return new LocalIPFSProvider(
      config.localIPFSApi,
      config.localIPFSGateway
    );
  }
  
  if (config.useMaiApi && config.ipfsApiUrl) {
    console.log('🌐 Using Mai API for IPFS uploads:', config.ipfsApiUrl);
    console.log(`📡 Using ${gateways.length} IPFS gateways for load balancing`);
    return new MaiAPIProvider(config.ipfsApiUrl);
  }
  
  // Fallback: If Mai API URL is configured, use it even without explicit flag
  if (config.ipfsApiUrl) {
    console.log('🌐 Using Mai API for IPFS uploads (fallback):', config.ipfsApiUrl);
    console.log(`📡 Using ${gateways.length} IPFS gateways for load balancing`);
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