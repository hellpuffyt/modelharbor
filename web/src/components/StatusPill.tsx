import type { HealthStatus } from "../types";

export function StatusPill({ status }: { status: HealthStatus }) {
  return (
    <span className={`status-pill ${status}`}>
      <span className={`status-dot ${status}`} aria-hidden="true" />
      {status}
    </span>
  );
}
