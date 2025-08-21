/**
 * Centralized environment configuration
 * Supports both Vite and Gatsby environments during migration
 */

// Helper to get env var with fallback
const getEnvVar = (viteKey: string, gatsbyKey: string, defaultValue = ""): string => {
  // Check for Vite environment variables - directly access import.meta.env
  let viteValue: string | undefined;
  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env) {
      viteValue = (import.meta as any).env[viteKey];
    }
  } catch (e) {
    // Not in Vite environment
  }

  // Check for process.env (Node/Gatsby environment)
  const gatsbyValue = typeof process !== "undefined" && process.env?.[gatsbyKey];

  const result = viteValue || gatsbyValue || defaultValue;

  // Debug critical IPFS config values
  if (viteKey.includes("IPFS") || viteKey.includes("MAI")) {
    console.debug(`Env var ${viteKey}: vite=${viteValue}, gatsby=${gatsbyValue}, result=${result}`);
  }

  return result;
};

// Helper to get boolean env var
const getBoolEnvVar = (viteKey: string, gatsbyKey: string, defaultValue = false): boolean => {
  const value = getEnvVar(viteKey, gatsbyKey, String(defaultValue));
  return value === "true";
};

export const config = {
  // Blockchain Configuration
  qipRegistryAddress: getEnvVar("VITE_QIP_REGISTRY_ADDRESS", "GATSBY_QIP_REGISTRY_ADDRESS") as `0x${string}`,
  baseRpcUrl: getEnvVar("VITE_BASE_RPC_URL", "GATSBY_BASE_RPC_URL", "http://localhost:8545"),
  walletConnectProjectId: getEnvVar("VITE_WALLETCONNECT_PROJECT_ID", "GATSBY_WALLETCONNECT_PROJECT_ID"),

  // IPFS Configuration
  useLocalIPFS: getBoolEnvVar("VITE_USE_LOCAL_IPFS", "GATSBY_USE_LOCAL_IPFS", false),
  // @deprecated - Pinata uploads are now handled server-side via Mai API
  pinataGateway: getEnvVar("VITE_PINATA_GATEWAY", "GATSBY_PINATA_GATEWAY", "https://gateway.pinata.cloud"),
  localIPFSApi: getEnvVar("VITE_LOCAL_IPFS_API", "GATSBY_LOCAL_IPFS_API", "http://localhost:5001"),
  localIPFSGateway: getEnvVar("VITE_LOCAL_IPFS_GATEWAY", "GATSBY_LOCAL_IPFS_GATEWAY", "http://localhost:8080"),
  ipfsApiUrl: getEnvVar("VITE_IPFS_API_URL", "GATSBY_IPFS_API_URL", ""),
  useMaiApi: getBoolEnvVar("VITE_USE_MAI_API", "GATSBY_USE_MAI_API", false),

  // App Configuration
  localMode: getBoolEnvVar("VITE_LOCAL_MODE", "GATSBY_LOCAL_MODE", false),
  useTestnet: getBoolEnvVar("VITE_USE_TESTNET", "GATSBY_USE_TESTNET", false),

  // Development Configuration
  isDevelopment: process.env.NODE_ENV === "development",
  isProduction: process.env.NODE_ENV === "production",
};

// Validation
export const validateConfig = () => {
  const errors: string[] = [];

  if (!config.qipRegistryAddress) {
    errors.push("QIP Registry address is not configured");
  }

  if (!config.walletConnectProjectId && config.isProduction) {
    errors.push("WalletConnect Project ID is required for production");
  }

  if (errors.length > 0) {
    console.error("Configuration errors:", errors);
    return false;
  }

  return true;
};

// Log configuration in development
if (config.isDevelopment) {
  console.log("🔧 App Configuration:", {
    registryAddress: config.qipRegistryAddress,
    useLocalIPFS: config.useLocalIPFS,
    localMode: config.localMode,
    walletConnectConfigured: !!config.walletConnectProjectId,
  });
}