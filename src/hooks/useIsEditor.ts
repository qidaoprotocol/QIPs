import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { base } from 'wagmi/chains';
import { config } from '../config/env';
import { QCIRegistryABI } from '../config/abis/QCIRegistry';

const EDITOR_ROLE_TTL_MS = Infinity; // EDITOR_ROLE bytes32 hash is a contract constant
const HAS_ROLE_TTL_MS = 60_000; // mirrors mai-api lib/editorRole.ts cache window

export interface UseIsEditorResult {
  isEditor: boolean;
  isLoading: boolean;
}

/**
 * Returns whether the connected wallet holds EDITOR_ROLE on the QCIRegistry.
 *
 * The result drives moderation-menu visibility on the comments UI; the API
 * gates the actual moderation action separately, so a UI-only bypass cannot
 * grant moderation power. Returns `{ isEditor: false }` when no wallet is
 * connected.
 */
export function useIsEditor(): UseIsEditorResult {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const registryAddress = config.registryAddress;

  // Step 1: read the EDITOR_ROLE bytes32 hash. It's a contract constant, so
  // we cache it forever per registry address.
  const editorRoleQuery = useQuery({
    queryKey: ['qip-comments', 'editor-role-hash', registryAddress],
    enabled: Boolean(publicClient && registryAddress),
    staleTime: EDITOR_ROLE_TTL_MS,
    gcTime: EDITOR_ROLE_TTL_MS,
    queryFn: async () => {
      if (!publicClient) throw new Error('public client unavailable');
      const hash = (await publicClient.readContract({
        address: registryAddress,
        abi: QCIRegistryABI,
        functionName: 'EDITOR_ROLE',
      })) as `0x${string}`;
      return hash;
    },
  });

  // Step 2: read hasRole(EDITOR_ROLE, address). Re-checked every 60 seconds
  // so a freshly granted role takes effect promptly. Refresh on focus is
  // disabled so toggling tabs doesn't burn RPC calls.
  const hasRoleQuery = useQuery({
    queryKey: ['qip-comments', 'is-editor', registryAddress, address?.toLowerCase()],
    enabled: Boolean(publicClient && registryAddress && address && editorRoleQuery.data),
    staleTime: HAS_ROLE_TTL_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!publicClient || !address || !editorRoleQuery.data) return false;
      const result = (await publicClient.readContract({
        address: registryAddress,
        abi: QCIRegistryABI,
        functionName: 'hasRole',
        args: [editorRoleQuery.data, address],
      })) as boolean;
      return result;
    },
  });

  return {
    isEditor: hasRoleQuery.data === true,
    isLoading: editorRoleQuery.isLoading || hasRoleQuery.isLoading,
  };
}
