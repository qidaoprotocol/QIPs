import React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  chainLabel,
  forceProbeChain,
  getSnapshot,
  isProbeInFlight,
  subscribe,
} from "../utils/rpcObservability";

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Pool-exhaustion banner.
 *
 * Subscribes to `pool:exhausted` / `pool:recovered` / `probe:started` /
 * `probe:finished` events from the observability store. When at least one
 * chain is exhausted, renders a single banner with chain-pills and a Retry
 * button. The Retry button calls forceProbe on every affected chain in
 * parallel; while the probe is in flight the button disables and shows a
 * spinner. After PROBE_TIMEOUT_MS without a recovery, the copy flips to
 * "Probe timed out — endpoints may be unreachable from this network" so the
 * user knows further retries on the same connection are unlikely to help.
 *
 * Banner fires only on full pool exhaustion. Partial degradation (1-of-N
 * cooling) is intentionally silent — viem's fallback handles the failover
 * and a per-blip toast would be noisy.
 */
export function RpcStatusBanner(): React.ReactElement | null {
  const [exhaustedChains, setExhaustedChains] = React.useState<number[]>(() =>
    deriveExhaustedFromSnapshot(),
  );
  const [probing, setProbing] = React.useState(false);
  const [timedOut, setTimedOut] = React.useState(false);
  const probeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const recompute = () => setExhaustedChains(deriveExhaustedFromSnapshot());
    const offExhausted = subscribe("pool:exhausted", recompute);
    const offRecovered = subscribe("pool:recovered", recompute);
    const offState = subscribe("endpoint:state-change", recompute);
    const offProbeStart = subscribe("probe:started", () => {
      setProbing(true);
      setTimedOut(false);
      if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
      probeTimerRef.current = setTimeout(() => {
        setProbing(false);
        setTimedOut(true);
      }, PROBE_TIMEOUT_MS);
    });
    const offProbeEnd = subscribe("probe:finished", () => {
      if (probeTimerRef.current) {
        clearTimeout(probeTimerRef.current);
        probeTimerRef.current = null;
      }
      setProbing(false);
      // recompute so the banner clears if any endpoint came back healthy
      recompute();
    });
    return () => {
      offExhausted();
      offRecovered();
      offState();
      offProbeStart();
      offProbeEnd();
      if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    };
  }, []);

  if (exhaustedChains.length === 0) return null;

  const handleRetry = async () => {
    if (probing) return; // debounce
    // Re-check in case any chain recovered between renders.
    const stillExhausted = deriveExhaustedFromSnapshot();
    if (stillExhausted.length === 0) {
      setExhaustedChains(stillExhausted);
      return;
    }
    // Skip if the observability layer reports an in-flight probe for any
    // affected chain.
    if (stillExhausted.some((id) => isProbeInFlight(id))) return;
    await Promise.allSettled(stillExhausted.map((id) => forceProbeChain(id)));
  };

  const labels = exhaustedChains.map((id) => chainLabel(id));
  const copy = timedOut
    ? `Probe timed out — endpoints may be unreachable from this network.`
    : `RPC unavailable on ${joinHumanReadable(labels)}.`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-3 shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-destructive">{copy}</p>
          <div className="flex flex-wrap gap-1">
            {labels.map((label) => (
              <span
                key={label}
                className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={probing}
              onClick={handleRetry}
              className="gap-2"
            >
              {probing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Retrying…
                </>
              ) : (
                "Retry"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function deriveExhaustedFromSnapshot(): number[] {
  const snapshot = getSnapshot();
  const out: number[] = [];
  for (const [chainIdStr, endpoints] of Object.entries(snapshot)) {
    const urls = Object.keys(endpoints);
    if (urls.length === 0) continue;
    const allDown = urls.every((url) => {
      const s = endpoints[url].state;
      return s !== "healthy" && s !== "unknown";
    });
    if (allDown) out.push(Number(chainIdStr));
  }
  return out;
}

function joinHumanReadable(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
