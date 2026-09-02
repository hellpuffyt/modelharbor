interface Props {
  kind: "loading" | "error" | "empty";
  title: string;
  detail?: string;
  onRetry?: () => void;
}

/** A shared loading / error / empty state used by every panel so the dashboard never
 * silently shows nothing or a blank flash while data is in flight. */
export function StateBlock({ kind, title, detail, onRetry }: Props) {
  return (
    <div className={`state-block${kind === "error" ? " error" : ""}`} role={kind === "error" ? "alert" : "status"}>
      {kind === "loading" && <div className="spinner" aria-hidden="true" />}
      <div className="state-title">{title}</div>
      {detail && <div>{detail}</div>}
      {onRetry && (
        <button type="button" className="retry-button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
