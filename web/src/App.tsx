import { CostPanel } from "./components/CostPanel";
import { HealthPanel } from "./components/HealthPanel";
import { RoutingPanel } from "./components/RoutingPanel";
import { useTheme } from "./hooks/useTheme";

const POLL_INTERVAL_MS = 5000;

export function App() {
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            MH
          </span>
          <div>
            <h1>ModelHarbor</h1>
          </div>
          <span className="tagline">control center for every configured LLM provider</span>
        </div>
        <div className="header-controls">
          <button type="button" className="icon-button" onClick={toggleTheme} aria-label="Toggle color theme" title="Toggle color theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      <div className="grid">
        <div>
          <HealthPanel intervalMs={POLL_INTERVAL_MS} />
          <RoutingPanel intervalMs={POLL_INTERVAL_MS} />
        </div>
        <div>
          <CostPanel intervalMs={POLL_INTERVAL_MS} />
        </div>
      </div>

      <p className="footer-note">ModelHarbor · polling every {POLL_INTERVAL_MS / 1000}s · mock-provider mode exercises the full pipeline without any real API keys</p>
    </div>
  );
}
