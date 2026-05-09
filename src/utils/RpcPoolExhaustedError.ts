/**
 * Typed error thrown when every endpoint in a chain's RPC pool has failed.
 *
 * Mirrors the ChainSwitchRejectedError idiom from src/hooks/useEnsureChain.ts:
 * a named class extending Error, with stable fields callers can branch on
 * without inspecting message strings. The outer transport wrapper in
 * src/utils/rpcPools.ts converts viem's aggregate "all transports failed"
 * shape into one of these so UI surfaces (the RpcStatusBanner, mid-write
 * forms in SnapshotModerator/SnapshotSubmitter/useStatusUpdateMutation) can
 * branch on `instanceof RpcPoolExhaustedError`.
 *
 * Aggregate-error-shape note (verified against viem 2.30.6,
 * `node_modules/viem/clients/transports/fallback.ts`): viem does not expose
 * a typed exhaustion class, so the wrapper pattern-matches on `errors[]`
 * presence + a message-prefix regex. If a viem upgrade changes the shape,
 * the wrapper's failure mode is "no longer recognized as exhaustion, the
 * original viem error propagates" — degraded but not catastrophic.
 */

import type { EndpointState } from "./rpcObservability";

export interface AttemptedEndpoint {
  readonly url: string;
  readonly state: EndpointState;
  readonly status?: number;
  readonly message?: string;
}

export class RpcPoolExhaustedError extends Error {
  readonly chainId: number;
  readonly attempted: readonly AttemptedEndpoint[];

  constructor(
    chainId: number,
    attempted: readonly AttemptedEndpoint[],
    cause?: unknown,
  ) {
    const summary = attempted
      .map((a) => `${a.url} (${a.state}${a.status ? ` ${a.status}` : ""})`)
      .join(", ");
    super(
      `RPC pool exhausted on chain ${chainId}: every endpoint failed. ` +
        `Attempted: ${summary || "(no endpoints registered)"}.`,
    );
    this.name = "RpcPoolExhaustedError";
    this.chainId = chainId;
    this.attempted = attempted;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}
