/**
 * Mai API Client for fetching QCIs from the centralized API endpoint
 * This provides a much faster alternative to direct blockchain fetching
 * with built-in caching and IPFS content support
 */

import { QCIStatus } from './qciClient';
import type {
  CommentListResponse,
  ListCommentsOptions,
  ModerationRequest,
  ModerationResponse,
  NonceResponse,
  PostCommentRequest,
  PostCommentResponse,
  VerifyRequest,
  VerifyResponse,
} from '../types/comments';

/**
 * QCI data as returned by the Mai API
 * Matches the format from /v3/qcis endpoint
 */
export interface MaiAPIQCI {
  qciNumber: number;
  author: string;
  title: string;
  chain: string;
  contentHash: string;
  ipfsUrl: string;
  createdAt: number;
  lastUpdated: number;
  status: string;
  statusCode: number;
  statusBytes32?: string; // bytes32 representation of status for v3 API
  implementor: string;
  implementationDate: number;
  snapshotProposalId: string;
  version: number;
  content?: string; // Optional IPFS content if requested
  contentError?: string; // Error if IPFS fetch failed
}

/**
 * Response format from the Mai API /v3/qcis endpoint
 */
export interface MaiAPIResponse {
  qcis: MaiAPIQCI[];
  totalCount: number;
  lastUpdated: number;
  chainId: number;
  contractAddress: string;
  cached: boolean;
  cacheTimestamp: number;
}

/**
 * Options for fetching QCIs from Mai API
 */
export interface FetchQCIsOptions {
  includeContent?: boolean; // Include IPFS content for ALL QCIs (slow)
  contentFor?: number[]; // Include IPFS content for specific QCI numbers
  forceRefresh?: boolean; // Bypass cache and fetch fresh data
  mockMode?: boolean; // Use mock data for testing (dev only)
}

/**
 * Mai API Client for QCI data
 */
export class MaiAPIClient {
  private readonly baseUrl: string;
  private defaultTimeout: number = 30000; // 30 seconds

  constructor(baseUrl: string = 'https://api.mai.finance') {
    this.baseUrl = baseUrl;
  }
  
  /**
   * Get the base URL for this client
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Fetch all QCIs from the Mai API
   * Starting from QCI 209 (first QCI in registry) to latest
   */
  async fetchQCIs(options: FetchQCIsOptions = {}): Promise<MaiAPIResponse> {
    const params = new URLSearchParams();

    if (options.includeContent) {
      params.append('includeContent', 'true');
    }

    if (options.contentFor && options.contentFor.length > 0) {
      params.append('contentFor', options.contentFor.join(','));
    }

    if (options.forceRefresh) {
      params.append('forceRefresh', 'true');
    }

    if (options.mockMode) {
      params.append('mockMode', 'true');
    }

    const url = `${this.baseUrl}/v3/qcis${params.toString() ? `?${params}` : ''}`;

    console.log('[MaiAPIClient] Fetching QCIs from:', url);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(this.defaultTimeout),
      });

      if (!response.ok) {
        throw new Error(`Mai API request failed: ${response.status} ${response.statusText}`);
      }

      const data: MaiAPIResponse = await response.json();

      console.log(`[MaiAPIClient] Received ${data.qcis.length} QCIs (cached: ${data.cached})`);

      // Validate that QCIs start from 209 as expected
      if (data.qcis.length > 0) {
        const minQipNumber = Math.min(...data.qcis.map(q => q.qciNumber));
        if (minQipNumber < 209) {
          console.warn(`[MaiAPIClient] Warning: Found QCI ${minQipNumber} which is below expected minimum of 209`);
        }
      }

      return data;
    } catch (error: any) {
      console.error('[MaiAPIClient] Error fetching QCIs:', error);
      throw error;
    }
  }

  /**
   * Fetch a specific QCI with its content
   */
  async fetchQCI(qciNumber: number): Promise<MaiAPIQCI | null> {
    const response = await this.fetchQCIs({
      contentFor: [qciNumber],
    });

    const qci = response.qcis.find(q => q.qciNumber === qciNumber);
    return qci || null;
  }

  /**
   * Get QCIs by status
   */
  async getQCIsByStatus(status: QCIStatus): Promise<MaiAPIQCI[]> {
    const response = await this.fetchQCIs();
    return response.qcis.filter(q => q.statusCode === status);
  }

  /**
   * Convert Mai API status string to status ID
   */
  static statusStringToId(status: string): QCIStatus {
    // Map old status strings to new 3-status system
    const statusMap: Record<string, number> = {
      'Draft': 0,
      'ReviewPending': 1, // Maps to Ready for Snapshot
      'Review': 1, // Maps to Ready for Snapshot
      'VotePending': 2, // Maps to Posted to Snapshot
      'Vote': 2, // Maps to Posted to Snapshot
      'Approved': 2, // Historical - maps to Posted
      'Rejected': 2, // Historical - maps to Posted
      'Implemented': 2, // Historical - maps to Posted
      'Superseded': 2, // Historical - maps to Posted
      'Withdrawn': 2, // Historical - maps to Posted
    };

    return statusMap[status] ?? 2; // Default to Posted for historical
  }

  /**
   * Convert status ID to display string (fallback when contract not available)
   */
  static statusIdToDisplay(status: QCIStatus): string {
    const statusMap: Record<number, string> = {
      0: 'Draft',
      1: 'Ready for Snapshot',
      2: 'Posted to Snapshot',
      3: 'Archived'
    };

    return statusMap[status] || `Status ${status}`;
  }

  /* ─────────────────────────────────────────────────────────
     QIP comments — auth (SIWE)
     ───────────────────────────────────────────────────────── */

  /**
   * Request a single-use SIWE nonce bound to the given address.
   *
   * Caller signs the SIWE message containing this nonce, then submits the
   * message + signature to verifyQipCommentSignature(). The plaintext nonce
   * is returned once; only the HMAC hash is persisted server-side.
   */
  async requestQipCommentNonce(address: string): Promise<NonceResponse> {
    return this.commentsJsonRequest<NonceResponse>(
      'POST',
      '/v2/auth/qip-comments/nonce',
      { address },
    );
  }

  /**
   * Verify a SIWE signature and exchange it for a session.
   *
   * On success returns a bearer token (kept in memory only — never persist
   * to localStorage) and the API also sets a same-origin HttpOnly session
   * cookie. Subsequent comment writes can use either authentication path.
   */
  async verifyQipCommentSignature(req: VerifyRequest): Promise<VerifyResponse> {
    return this.commentsJsonRequest<VerifyResponse>(
      'POST',
      '/v2/auth/qip-comments/verify',
      req,
    );
  }

  /* ─────────────────────────────────────────────────────────
     QIP comments — public reads + gated writes
     ───────────────────────────────────────────────────────── */

  /**
   * List visible (non-hidden) comments for a QCI, newest-first.
   *
   * No auth required for reading. Use the `before` cursor (returned as
   * `nextBefore` in each page) for infinite-scroll pagination. Hidden
   * comments are filtered server-side and never appear in the response.
   */
  async listQipComments(opts: ListCommentsOptions): Promise<CommentListResponse> {
    const params = new URLSearchParams();
    params.append('qciId', String(opts.qciId));
    if (opts.limit !== undefined) params.append('limit', String(opts.limit));
    if (opts.before !== undefined) params.append('before', String(opts.before));

    const url = `${this.baseUrl}/v2/comments?${params.toString()}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.sessionToken) {
      headers.Authorization = `Bearer ${opts.sessionToken}`;
    }

    // GET is anonymous-by-default — the comment list does not require
    // auth. Use credentials: 'omit' so cross-origin reads aren't blocked
    // by the CORS preflight against `Access-Control-Allow-Origin: *`
    // (browsers reject `*` + `credentials: include`). Same-origin reads
    // don't need cookies for this route.
    const response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'omit',
      signal: AbortSignal.timeout(this.defaultTimeout),
    });

    if (!response.ok) {
      throw new Error(`Mai API request failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as CommentListResponse;
  }

  /**
   * Post a comment on a QCI.
   *
   * Returns a discriminated union — callers should branch on `result.ok`
   * and `result.status`. The 403 case carries the API's actual `threshold`
   * and `currentVp` so the toast can render the values the server saw,
   * not anything the client computed locally.
   */
  async postQipComment(req: PostCommentRequest): Promise<PostCommentResponse> {
    return this.commentsResultRequest<PostCommentResponse>(
      'POST',
      '/v2/comments',
      { qciId: req.qciId, body: req.body },
      req.sessionToken,
      (status, comment) => ({ ok: true, status, comment }) as never,
    ) as Promise<PostCommentResponse>;
  }

  /** Editor-only: hide a comment. Idempotent — 409 if already hidden. */
  async hideQipComment(req: ModerationRequest): Promise<ModerationResponse> {
    return this.commentsResultRequest<ModerationResponse>(
      'POST',
      `/v2/comments/${req.commentId}/hide`,
      req.reason !== undefined ? { reason: req.reason } : {},
      req.sessionToken,
      (_status, payload) => ({
        ok: true,
        commentId: (payload as { commentId: number }).commentId,
        actionId: (payload as { actionId: number }).actionId,
      }),
    ) as Promise<ModerationResponse>;
  }

  /** Editor-only: unhide a previously hidden comment. */
  async unhideQipComment(req: ModerationRequest): Promise<ModerationResponse> {
    return this.commentsResultRequest<ModerationResponse>(
      'POST',
      `/v2/comments/${req.commentId}/unhide`,
      req.reason !== undefined ? { reason: req.reason } : {},
      req.sessionToken,
      (_status, payload) => ({
        ok: true,
        commentId: (payload as { commentId: number }).commentId,
        actionId: (payload as { actionId: number }).actionId,
      }),
    ) as Promise<ModerationResponse>;
  }

  /* ─────────────────────────────────────────────────────────
     Shared transport helpers for the comment endpoints
     ───────────────────────────────────────────────────────── */

  /**
   * Fire a JSON request and throw on any non-2xx — used for the auth
   * endpoints where every failure is fatal to the flow.
   *
   * Uses credentials: 'omit' because the API responds with
   * Access-Control-Allow-Origin: *, which Chrome refuses to honor for
   * credentialed cross-origin requests (response is dropped with
   * net::ERR_FAILED). The verify response body returns the bearer token,
   * which is the primary auth mechanism; the Set-Cookie returned alongside
   * is only useful for same-origin deployments. Same-origin browsers can
   * still use cookies with `credentials: 'same-origin'` (the default), but
   * cross-origin must rely on the Bearer header.
   */
  private async commentsJsonRequest<T>(
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'omit',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.defaultTimeout),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const errBody = (await response.json()) as { error?: string; message?: string };
        detail = errBody.error || errBody.message || '';
      } catch {
        // Non-JSON error body; fall through to status text.
      }
      throw new Error(
        `Mai API ${path} failed: ${response.status} ${response.statusText}${
          detail ? ` (${detail})` : ''
        }`,
      );
    }
    return (await response.json()) as T;
  }

  /**
   * Fire a JSON request and return a discriminated `{ ok, ... }` result for
   * routes whose error states the caller wants to pattern-match (POST
   * comment, moderation actions). Auth failures and rate limits are NOT
   * thrown — they're returned as structured errors.
   */
  private async commentsResultRequest<TResult>(
    method: string,
    path: string,
    body: unknown,
    sessionToken: string | undefined,
    onSuccess: (status: number, payload: unknown) => unknown,
  ): Promise<TResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    // credentials: 'omit' — see commentsJsonRequest above for why this
    // matters cross-origin against `Access-Control-Allow-Origin: *`. Bearer
    // is the cross-origin auth path; same-origin clients can switch to
    // 'same-origin' (the default) for a cookie path if/when we land
    // origin-specific CORS.
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'omit',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.defaultTimeout),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (response.ok) {
      return onSuccess(response.status, payload) as TResult;
    }

    // Coerce the server's structured error into the discriminated shape.
    const err = payload as Record<string, unknown>;
    const base = {
      ok: false as const,
      status: response.status as 401 | 403 | 404 | 409 | 413 | 429 | 503 | 400 | 500,
      error: typeof err.error === 'string' ? err.error : 'unknown',
    };
    return { ...base, ...err } as TResult;
  }

  /**
   * Convert Mai API QCI to app's QCIData format
   */
  static toQCIData(apiQip: MaiAPIQCI): any {
    // Convert implementation date
    const implDate = apiQip.implementationDate > 0
      ? new Date(apiQip.implementationDate * 1000).toISOString().split('T')[0]
      : 'None';

    // Convert created date
    const created = apiQip.createdAt > 0
      ? new Date(apiQip.createdAt * 1000).toISOString().split('T')[0]
      : 'None';

    // Process proposal URL - extract just the proposal ID if it's a full URL
    let proposalId = 'None';
    if (apiQip.snapshotProposalId && 
        apiQip.snapshotProposalId !== '' &&
        apiQip.snapshotProposalId !== 'None' &&
        apiQip.snapshotProposalId !== 'N/A' &&
        apiQip.snapshotProposalId !== 'TBU' &&
        apiQip.snapshotProposalId !== 'tbu') {
      // If it's a full URL, extract the proposal ID
      const match = apiQip.snapshotProposalId.match(/proposal\/(0x[a-fA-F0-9]+)/);
      proposalId = match ? match[1] : apiQip.snapshotProposalId;
    }

    // Format author - if it's an address, shorten it, otherwise use as-is
    let authorDisplay = apiQip.author;
    if (authorDisplay && authorDisplay.startsWith('0x')) {
      // Check if it's the common author address
      if (authorDisplay.toLowerCase() === '0x0000000000000000000000000000000000000001') {
        authorDisplay = 'QiDao Team';
      } else {
        // Shorten address: 0x1234...5678
        authorDisplay = `${authorDisplay.slice(0, 6)}...${authorDisplay.slice(-4)}`;
      }
    }

    return {
      qciNumber: apiQip.qciNumber,
      title: apiQip.title,
      chain: apiQip.chain,
      status: MaiAPIClient.statusIdToDisplay(apiQip.statusCode as QCIStatus),
      statusEnum: apiQip.statusCode as QCIStatus,
      author: authorDisplay,
      authorAddress: apiQip.author, // Keep original address for reference
      implementor: apiQip.implementor || 'None',
      implementationDate: implDate,
      proposal: proposalId,
      created,
      content: apiQip.content || '',
      ipfsUrl: apiQip.ipfsUrl,
      contentHash: apiQip.contentHash,
      version: apiQip.version,
      source: 'api' as const,
      lastUpdated: apiQip.lastUpdated * 1000, // Convert to milliseconds
      // Include the full snapshot URL for reference if needed
      snapshotProposalUrl: apiQip.snapshotProposalId
    };
  }
}

/**
 * Singleton instance for convenience
 */
let maiApiClient: MaiAPIClient | null = null;

export function getMaiAPIClient(baseUrl?: string): MaiAPIClient {
  if (!maiApiClient || (baseUrl && maiApiClient.getBaseUrl() !== baseUrl)) {
    maiApiClient = new MaiAPIClient(baseUrl);
  }
  return maiApiClient;
}