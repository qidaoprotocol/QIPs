import { useReadContracts } from 'wagmi';
import { type Address } from 'viem';
import { QCIRegistryABI } from '../config/abis/QCIRegistry';

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

interface UseCheckRolesOptions {
  address: Address | undefined;
  registryAddress: Address;
  enabled?: boolean;
}

/**
 * Hook to check if an address has editor or admin roles
 * Uses WAGMI's useReadContracts for efficient batched reads with automatic caching
 */
export function useCheckRoles({ address, registryAddress, enabled = true }: UseCheckRolesOptions) {
  // Batch all role checks in a single multicall
  const { data, isLoading, error } = useReadContracts({
    contracts: [
      {
        address: registryAddress,
        abi: QCIRegistryABI,
        functionName: 'EDITOR_ROLE',
      },
    ],
    query: {
      enabled: enabled && !!address,
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
  });

  // Get the EDITOR_ROLE value from the first call
  const editorRoleHash = data?.[0]?.status === 'success' ? data[0].result : undefined;

  // Now batch the hasRole checks
  const { data: roleData, isLoading: isLoadingRoles } = useReadContracts({
    contracts: editorRoleHash
      ? [
          {
            address: registryAddress,
            abi: QCIRegistryABI,
            functionName: 'hasRole',
            args: [editorRoleHash as `0x${string}`, address!],
          },
          {
            address: registryAddress,
            abi: QCIRegistryABI,
            functionName: 'hasRole',
            args: [DEFAULT_ADMIN_ROLE, address!],
          },
        ]
      : [],
    query: {
      enabled: enabled && !!address && !!editorRoleHash,
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
  });

  const hasEditorRole = roleData?.[0]?.status === 'success' ? (roleData[0].result as boolean) : false;
  const hasAdminRole = roleData?.[1]?.status === 'success' ? (roleData[1].result as boolean) : false;

  return {
    isEditor: hasEditorRole,
    isAdmin: hasAdminRole,
    hasAnyRole: hasEditorRole || hasAdminRole,
    isLoading: isLoading || isLoadingRoles,
    error,
    editorRoleHash,
  };
}
