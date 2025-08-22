/**
 * Centralized environment configuration
 * Uses Vite environment variables
 */

// Helper to get env var with fallback
const getEnvVar = (key: string, defaultValue = ""): string => {
  // Check for Vite environment variables - directly access import.meta.env
  let value: string | undefined;
  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env) {
      value = (import.meta as any).env[key];
    }
  } catch (e) {
    // Not in Vite environment
  }

  // Fallback to process.env for build scripts
  if (!value && typeof process !== "undefined" && process.env?.[key]) {
    value = process.env[key];
  }

  const result = value || defaultValue;

  // Debug critical IPFS config values
  if (key.includes("IPFS") || key.includes("MAI")) {
    console.debug(`Env var ${key}: ${result}`);
  }

  return result;
};

// Helper to get boolean env var
const getBoolEnvVar = (key: string, defaultValue = false): boolean => {
  const value = getEnvVar(key, String(defaultValue));
  return value === "true";
};

export const config = {
  // Blockchain Configuration
  qipRegistryAddress: getEnvVar("VITE_QIP_REGISTRY_ADDRESS") as `0x${string}`,
  baseRpcUrl: getEnvVar("VITE_BASE_RPC_URL", "http://localhost:8545"),
  walletConnectProjectId: getEnvVar("VITE_WALLETCONNECT_PROJECT_ID"),

  // IPFS Configuration
  useLocalIPFS: getBoolEnvVar("VITE_USE_LOCAL_IPFS", false),
  pinataGateway: getEnvVar("VITE_PINATA_GATEWAY", "https://gateway.pinata.cloud"),
  localIPFSApi: getEnvVar("VITE_LOCAL_IPFS_API", "http://localhost:5001"),
  localIPFSGateway: getEnvVar("VITE_LOCAL_IPFS_GATEWAY", "http://localhost:8080"),
  ipfsApiUrl: getEnvVar("VITE_IPFS_API_URL", ""),
  useMaiApi: getBoolEnvVar("VITE_USE_MAI_API", false),

  // App Configuration
  localMode: getBoolEnvVar("VITE_LOCAL_MODE", false),
  useTestnet: getBoolEnvVar("VITE_USE_TESTNET", false),

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