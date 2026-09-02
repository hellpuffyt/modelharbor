import { fetchUsage, fetchUsageEvents } from "../api";
import { usePolling } from "../hooks/usePolling";
import type { UsageAggregate } from "../types";
import { StateBlock } from "./StateBlock";

function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;
}

function BarList({ items, valueFmt }: { items: UsageAggregate[]; valueFmt: (a: UsageAggregate) => string }) {
  const max = Math.max(...items.map((i) => i.totalCostUsd), 0.000001);
  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.key}>
          <span className="bar-key" title={item.key}>
            {item.key}
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${String((item.totalCostUsd / max) * 100)}%` }} />
          </span>
          <span className="bar-value">{valueFmt(item)}</span>
        </div>
      ))}
    </div>
  );
}

export function CostPanel({ intervalMs }: { intervalMs: number }) {
  const usage = usePolling(() => fetchUsage(), intervalMs, [intervalMs]);
  const events = usePolling(() => fetchUsageEvents(8), intervalMs, [intervalMs]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Usage &amp; cost</h2>
        <span className="panel-sub">live from executed requests</span>
      </div>

      {usage.status === "loading" && <StateBlock kind="loading" title="Loading usage summary…" />}
      {usage.status === "error" && usage.data === null && (
        <StateBlock kind="error" title="Couldn't load usage data" detail={usage.error} onRetry={usage.refresh} />
      )}

      {usage.data && usage.data.totalRequests === 0 && (
        <StateBlock kind="empty" title="No requests executed yet" detail={'Run a task from the routing panel to populate the cost dashboard.'} />
      )}

      {usage.data && usage.data.totalRequests > 0 && (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <div className="stat-label">Total requests</div>
              <div className="stat-value">{usage.data.totalRequests}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Total cost</div>
              <div className="stat-value">{formatUsd(usage.data.totalCostUsd)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Tokens (p/c)</div>
              <div className="stat-value" style={{ fontSize: 14 }}>
                {usage.data.totalPromptTokens} / {usage.data.totalCompletionTokens}
              </div>
            </div>
          </div>

          {usage.data.byModel.length > 0 && (
            <>
              <div className="section-label">Cost by model</div>
              <BarList items={usage.data.byModel} valueFmt={(a) => formatUsd(a.totalCostUsd)} />
            </>
          )}

          {usage.data.byTask.length > 0 && (
            <>
              <div className="section-label">Cost by task</div>
              <BarList items={usage.data.byTask} valueFmt={(a) => `${String(a.requestCount)}x`} />
            </>
          )}
        </>
      )}

      <div className="section-label">Recent events</div>
      {events.status === "loading" && <StateBlock kind="loading" title="Loading recent events…" />}
      {events.data && events.data.events.length === 0 && <StateBlock kind="empty" title="No events yet" />}
      {events.data && events.data.events.length > 0 && (
        <div className="table-wrap">
          <table className="events-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Task</th>
                <th>Cost</th>
                <th>Latency</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {events.data.events.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.timestamp).toLocaleTimeString()}</td>
                  <td>
                    {e.providerId}/{e.modelId}
                  </td>
                  <td>{e.task}</td>
                  <td>{formatUsd(e.costUsd)}</td>
                  <td>{e.latencyMs}ms</td>
                  <td className={e.success ? "badge-success" : "badge-fail"}>{e.success ? "ok" : `fail${e.failoverCount > 0 ? ` (retry ${String(e.failoverCount)})` : ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
