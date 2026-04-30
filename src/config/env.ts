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

  // Debug critical config values
  if (key.includes("IPFS") || key.includes("MAI") || key.includes("BASE_RPC")) {
    console.debug(`Env var ${key}: ${result || '(using default: ' + defaultValue + ')'}`);
  }

  return result;
};

// Helper to get boolean env var
const getBoolEnvVar = (key: string, defaultValue = false): boolean => {
  const value = getEnvVar(key, String(defaultValue));
  return value === "true";
};

const rawRegistryAddress = getEnvVar("VITE_QCI_REGISTRY_ADDRESS");
const registryAddressValue = rawRegistryAddress || "0x0bd64B68473Fb5747fa1884F7882615d09C8c161";

export const config = {
  // Blockchain Configuration
  qciRegistryAddress: registryAddressValue as `0x${string}`,
  registryAddress: registryAddressValue as `0x${string}`, // Add alias for compatibility
  baseRpcUrl: getEnvVar("VITE_BASE_RPC_URL", "http://localhost:8545"),
  walletConnectProjectId: getEnvVar("VITE_WALLETCONNECT_PROJECT_ID"),

  // IPFS Configuration
  useLocalIPFS: getBoolEnvVar("VITE_USE_LOCAL_IPFS", false),
  ipfsGateway: getEnvVar("VITE_IPFS_GATEWAY", "https://gateway.pinata.cloud"),
  pinataGroupId: getEnvVar("VITE_PINATA_GROUP_ID", ""),
  localIPFSApi: getEnvVar("VITE_LOCAL_IPFS_API", "http://localhost:5001"),
  localIPFSGateway: getEnvVar("VITE_IPFS_GATEWAY", getEnvVar("VITE_LOCAL_IPFS_GATEWAY", "http://localhost:8080")),
  ipfsApiUrl: getEnvVar("VITE_IPFS_API_URL", ""),
  useMaiApi: getBoolEnvVar("VITE_USE_MAI_API", false),

  // Mai API Configuration for QCI fetching
  maiApiUrl: getEnvVar("VITE_MAI_API_URL", "https://api.mai.finance"),

  // QIP comments body byte cap; must agree with the API's
  // QIP_COMMENTS_BODY_MAX_BYTES so the client-side counter and the server-side
  // cap reject the same inputs. Default 8192 (8 KB).
  qipCommentsBodyMaxBytes: parseInt(getEnvVar("VITE_QIP_COMMENTS_BODY_MAX_BYTES", "8192"), 10) || 8192,

  // App Configuration
  localMode: getBoolEnvVar("VITE_LOCAL_MODE", false),
  useTestnet: getBoolEnvVar("VITE_USE_TESTNET", false),

  // Snapshot Configuration
  snapshotSpace: getEnvVar("VITE_SNAPSHOT_SPACE", "qidao.eth"),
  snapshotTestMode: getBoolEnvVar("VITE_SNAPSHOT_TEST_MODE", false),
  snapshotTestSpace: getEnvVar("VITE_SNAPSHOT_TEST_SPACE", "testdevtest.eth"),

  // Development Configuration
  isDevelopment: process.env.NODE_ENV === "development",
  isProduction: process.env.NODE_ENV === "production",
};

// Validation
export const validateConfig = () => {
  const errors: string[] = [];

  if (!config.qciRegistryAddress) {
    errors.push("QCI Registry address is not configured");
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
    registryAddress: config.qciRegistryAddress,
    useLocalIPFS: config.useLocalIPFS,
    localMode: config.localMode,
    walletConnectConfigured: !!config.walletConnectProjectId,
    maiApiUrl: config.maiApiUrl,
  });
}