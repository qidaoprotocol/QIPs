import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { config } from '../config/env';
import { getMaiAPIClient } from '../services/maiApiClient';
import type {
  Comment,
  CommentListResponse,
  DeleteOwnCommentResponse,
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

interface DeleteCommentArgs {
  commentId: number;
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

  /**
   * Self-delete a comment authored by the current session. Performs an
   * optimistic cache removal and rolls back on failure (server-side error
   * or network failure). Returns the discriminated API result so callers
   * can render specific error toasts (401/403/etc.).
   */
  deleteComment: (args: DeleteCommentArgs) => Promise<DeleteOwnCommentResponse>;
  isDeleting: boolean;
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
      // Only mutate the cache on a real insert. A 403 / 401 / 413 / etc. is
      // a structured rejection — there's no new row to fold in.
      if (!result.ok) return;
      // Direct cache merge using the row the server already returned: skips
      // the invalidate→refetch round trip so the comment appears in the
      // list synchronously when the toast fires. The next background fetch
      // will dedupe by `id`.
      queryClient.setQueryData<InfiniteData<CommentListResponse>>(
        queryKeys.qipComments(qciId),
        (oldData) => {
          if (!oldData || oldData.pages.length === 0) return oldData;
          const [firstPage, ...restPages] = oldData.pages;
          return {
            ...oldData,
            pages: [
              { ...firstPage, comments: [result.comment, ...firstPage.comments] },
              ...restPages,
            ],
          };
        },
      );
    },
  });

  // Optimistic delete: remove the row from cache before the request lands so
  // the UI feels instant. On any rejection (server 4xx/5xx, network error)
  // we restore the snapshot taken in `onMutate` so the comment reappears.
  type DeleteContext = {
    previous: InfiniteData<CommentListResponse> | undefined;
  };

  const deleteMutation = useMutation<
    DeleteOwnCommentResponse,
    Error,
    DeleteCommentArgs,
    DeleteContext
  >({
    mutationFn: async ({ commentId, sessionToken }) => {
      const result = await client.deleteOwnQipComment({ commentId, sessionToken });
      // A structured `{ ok: false, ... }` rejection must trigger rollback —
      // useMutation only treats thrown errors as failures, so coerce here.
      if (!result.ok) {
        const err = new Error(result.error) as Error & {
          deleteResult: DeleteOwnCommentResponse;
        };
        err.deleteResult = result;
        throw err;
      }
      return result;
    },
    onMutate: ({ commentId }) => {
      const key = queryKeys.qipComments(qciId);
      const previous =
        queryClient.getQueryData<InfiniteData<CommentListResponse>>(key);
      if (previous) {
        queryClient.setQueryData<InfiniteData<CommentListResponse>>(key, {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            comments: page.comments.filter((c) => c.id !== commentId),
          })),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.qipComments(qciId),
          context.previous,
        );
      }
    },
  });

  // Wrapper preserves the discriminated-union return shape callers expect.
  // useMutation throws on `{ ok: false }` so we re-derive the structured
  // result from the thrown error's payload (or rethrow on network errors).
  const deleteComment = async (
    args: DeleteCommentArgs,
  ): Promise<DeleteOwnCommentResponse> => {
    try {
      return await deleteMutation.mutateAsync(args);
    } catch (err) {
      const carried = (err as { deleteResult?: DeleteOwnCommentResponse })
        .deleteResult;
      if (carried) return carried;
      throw err;
    }
  };

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
    deleteComment,
    isDeleting: deleteMutation.isPending,
  };
}
