import { useState, type FormEvent } from "react";
import { ApiError, fetchRoute, runTask } from "../api";
import { usePolling } from "../hooks/usePolling";
import { TASK_TYPES, type ExecuteResult, type TaskType } from "../types";
import { StateBlock } from "./StateBlock";

interface RunState {
  status: "idle" | "running" | "done" | "error";
  result: ExecuteResult | null;
  error: string | null;
}

export function RoutingPanel({ intervalMs }: { intervalMs: number }) {
  const [task, setTask] = useState<TaskType>("chat");
  const [prompt, setPrompt] = useState("Summarize the latest incident report in two sentences.");
  const [run, setRun] = useState<RunState>({ status: "idle", result: null, error: null });

  const decision = usePolling(() => fetchRoute(task), intervalMs, [task, intervalMs]);

  async function handleRun(e: FormEvent) {
    e.preventDefault();
    if (prompt.trim().length === 0) return;
    setRun({ status: "running", result: null, error: null });
    try {
      const result = await runTask(task, prompt);
      setRun({ status: "done", result, error: null });
      decision.refresh();
    } catch (err) {
      setRun({ status: "error", result: null, error: err instanceof ApiError ? err.message : "unexpected error" });
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Task-aware routing</h2>
        <span className="panel-sub">candidates ranked by priority, unhealthy ones skipped</span>
      </div>

      <div className="task-tabs" role="tablist" aria-label="Task type">
        {TASK_TYPES.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === task} className={`task-tab${t === task ? " active" : ""}`} onClick={() => setTask(t)}>
            {t}
          </button>
        ))}
      </div>

      {decision.status === "loading" && <StateBlock kind="loading" title="Computing routing decision…" />}
      {decision.status === "error" && decision.data === null && (
        <StateBlock kind="error" title="Couldn't compute a routing decision" detail={decision.error} onRetry={decision.refresh} />
      )}

      {decision.data && (
        <>
          <div className="decision-chain">
            {decision.data.attempted.length === 0 && <StateBlock kind="empty" title={`No model is registered for "${task}"`} />}
            {decision.data.attempted.map((a, i) => (
              <div className="attempt-row" key={`${a.candidate.providerId}/${a.candidate.modelId}-${String(i)}`}>
                <span className="candidate">
                  {a.candidate.providerId}/{a.candidate.modelId}
                </span>
                <span className={`attempt-outcome ${a.outcome}`}>{a.outcome.replace("skipped-", "skip: ")}</span>
              </div>
            ))}
          </div>
          <div className="route-reason">{decision.data.reason}</div>
        </>
      )}

      <form className="run-form" onSubmit={(e) => void handleRun(e)}>
        <label htmlFor="prompt-input" className="section-label" style={{ margin: 0 }}>
          Try it: execute this task through the router
        </label>
        <textarea id="prompt-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Enter a prompt to route and execute…" />
        <div className="run-form-actions">
          <button type="submit" className="primary-button" disabled={run.status === "running"}>
            {run.status === "running" ? "Running…" : `Run "${task}"`}
          </button>
          {run.status === "running" && <span className="panel-sub">failover happens automatically if the top pick errors</span>}
        </div>
      </form>

      {run.status === "done" && run.result && (
        <div className="run-result">
          <strong>{run.result.chosen ? `${run.result.chosen.providerId}/${run.result.chosen.modelId}` : "no candidate succeeded"}</strong>
          {"\n"}
          {run.result.text ?? "(no output — every candidate failed)"}
        </div>
      )}
      {run.status === "error" && <div className="run-result error">{run.error}</div>}
    </section>
  );
}
