import { fetchHealth } from "../api";
import { usePolling } from "../hooks/usePolling";
import { StateBlock } from "./StateBlock";
import { StatusPill } from "./StatusPill";

function formatLatency(ms: number | null): string {
  return ms === null ? "—" : `${String(ms)}ms`;
}

function formatContext(tokens: number): string {
  return tokens >= 1000 ? `${String(Math.round(tokens / 1000))}k ctx` : `${String(tokens)} ctx`;
}

export function HealthPanel({ intervalMs }: { intervalMs: number }) {
  const state = usePolling(() => fetchHealth(), intervalMs, [intervalMs]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Provider health</h2>
        <span className="panel-sub">
          {state.status === "ready" ? `updated ${new Date(state.data.checkedAt).toLocaleTimeString()}` : `polling every ${String(intervalMs / 1000)}s`}
        </span>
      </div>

      {state.status === "loading" && <StateBlock kind="loading" title="Checking every provider…" />}

      {state.status === "error" && state.data === null && (
        <StateBlock kind="error" title="Couldn't reach the ModelHarbor server" detail={state.error} onRetry={state.refresh} />
      )}

      {state.data && state.data.models.length === 0 && <StateBlock kind="empty" title="No models configured" detail="Add a provider to modelharbor.config.json to see health data here." />}

      {state.data && state.data.models.length > 0 && (
        <div className="health-grid">
          {state.data.models.map((m) => (
            <div className="health-card" key={`${m.providerId}/${m.modelId}`}>
              <div className="health-card-top">
                <StatusPill status={m.status} />
              </div>
              <div className="model-id">{m.modelId}</div>
              <div className="provider-label">{m.providerLabel}</div>
              <div className="health-card-meta">
                <span>
                  latency <span className="meta-value">{formatLatency(m.latencyMs)}</span>
                </span>
                <span>{formatContext(m.contextLength)}</span>
              </div>
              {m.error && <div className="health-card-error">{m.error}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
