import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { config } from '../config/env';
import { getMaiAPIClient } from '../services/maiApiClient';
import type {
  Comment,
  CommentListResponse,
  PostCommentResponse,
} from '../types/comments';
import { queryKeys } from '../utils/queryKeys';

const PAGE_SIZE = 50;
const STALE_TIME_MS = 30_000;

interface PostCommentArgs {
  body: string;
  /**
   * Optional bearer token. When omitted, the same-origin HttpOnly cookie
   * authenticates the request (cross-origin deployments must pass the token).
   */
  sessionToken?: string;
}

export interface UseCommentsResult {
  /** Flattened newest-first list across every loaded page. */
  comments: Comment[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;

  hasMore: boolean;
  isFetchingMore: boolean;
  fetchMore: () => void;

  /**
   * Post a comment. Returns the discriminated API result so callers can
   * branch on `result.ok` and `result.status` (the 403 path carries the
   * server-supplied threshold and currentVp values).
   */
  postComment: (args: PostCommentArgs) => Promise<PostCommentResponse>;
  isPosting: boolean;
}

/**
 * Cursor-paginated comment list for a single QCI, keyed on qciId.
 *
 * Anonymous reads work without a wallet — the comment list is publicly
 * visible. Hidden comments are filtered server-side and never appear in
 * any page.
 */
export function useComments(qciId: number): UseCommentsResult {
  const queryClient = useQueryClient();
  const client = getMaiAPIClient(config.maiApiUrl);

  const query = useInfiniteQuery<CommentListResponse, Error>({
    queryKey: queryKeys.qipComments(qciId),
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) =>
      client.listQipComments({
        qciId,
        limit: PAGE_SIZE,
        before: typeof pageParam === 'number' ? pageParam : undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: false,
    enabled: Number.isInteger(qciId) && qciId >= 0,
  });

  const mutation = useMutation<PostCommentResponse, Error, PostCommentArgs>({
    mutationFn: async ({ body, sessionToken }) =>
      client.postQipComment({ qciId, body, sessionToken }),
    onSuccess: (result) => {
      // Only invalidate on a real insert. A 403 / 401 / 413 / etc. is a
      // structured rejection — there's no new row to fold into the list.
      if (result.ok) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.qipComments(qciId),
        });
      }
    },
  });

  return {
    comments: query.data?.pages.flatMap((p) => p.comments) ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    hasMore: Boolean(query.hasNextPage),
    isFetchingMore: query.isFetchingNextPage,
    fetchMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
    postComment: mutation.mutateAsync,
    isPosting: mutation.isPending,
  };
}
