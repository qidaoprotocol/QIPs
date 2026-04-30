/**
 * QIP comment API contract types.
 *
 * These mirror the public response shape produced by the comments API on the
 * Mai API service. Internal-only fields (sig, sigSchemaVersion,
 * strategiesJson) are deliberately omitted from the consumer-facing surface
 * — they are forward-compatibility columns for the EIP-712 verifier path
 * and must not be relied on by the frontend yet.
 */

/** A single comment, as returned by GET /v2/comments and POST /v2/comments. */
export interface Comment {
  id: number;
  qciId: number;
  /** Mirror of the QIP number once a QCI graduates to a Snapshot proposal. */
  qipNumber: number | null;
  /** Lowercase 0x-prefixed 42-char address. */
  author: string;
  /** Markdown body. Untrusted UGC — render through SafeMarkdown only. */
  body: string;
  /** Reserved for future threading; always null in v1. */
  parentCommentId: number | null;

  /** Vote-power evidence captured at write time (nullable while Option D is dormant). */
  snapshotBlock: number | null;
  vpAtPost: string | null;
  strategiesHash: string | null;

  /** Soft-delete columns — populated when an editor hides the comment. */
  hiddenAt: string | null;
  hiddenBy: string | null;
  hiddenReason: string | null;

  createdAt: string;

  /** Server-resolved ENS primary name; null when no ENS is registered. */
  ensName: string | null;
}

/** GET /v2/comments?qciId=&limit=&before= */
export interface CommentListResponse {
  comments: Comment[];
  /** Cursor for the next page; null when no more rows. */
  nextBefore: number | null;
}

export interface ListCommentsOptions {
  qciId: number;
  limit?: number;
  before?: number;
  /** Optional bearer for authenticated reads. Public reads work without a token. */
  sessionToken?: string;
}

/* ─────────────────────────────────────────────────────────
   Auth — SIWE nonce + verify
   ───────────────────────────────────────────────────────── */

export interface NonceResponse {
  nonce: string;
  expiresAt: string;
}

export interface VerifyRequest {
  message: string;
  signature: string;
}

export interface VerifyResponse {
  ok: true;
  address: string;
  expiresAt: string;
  /** Plaintext bearer token. Returned once; never persisted to disk client-side. */
  token: string;
}

/* ─────────────────────────────────────────────────────────
   POST /v2/comments — discriminated result
   ───────────────────────────────────────────────────────── */

export interface PostCommentRequest {
  qciId: number;
  body: string;
  /** Optional override; defaults to the cookie-borne session if omitted. */
  sessionToken?: string;
}

export type PostCommentResponse =
  | { ok: true; comment: Comment }
  | { ok: false; status: 401; error: string }
  | { ok: false; status: 403; error: "vp_below_threshold"; threshold: string; currentVp: string }
  | { ok: false; status: 413; error: "body_too_large"; maxBytes: number }
  | { ok: false; status: 429; error: "rate_limited" }
  | { ok: false; status: 503; error: "vp_scoring_unavailable" | "vp_threshold_misconfigured" | "vp_value_unparseable"; cause?: string }
  | { ok: false; status: 400 | 500; error: string };

/* ─────────────────────────────────────────────────────────
   Moderation — POST /v2/comments/:id/{hide,unhide}
   ───────────────────────────────────────────────────────── */

export interface ModerationRequest {
  commentId: number;
  reason?: string;
  sessionToken?: string;
}

export type ModerationResponse =
  | { ok: true; commentId: number; actionId: number }
  | { ok: false; status: 401 | 403 | 404 | 409 | 400 | 500; error: string };
