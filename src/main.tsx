import React, { Component, ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./styles/app-shell.css";
import "./styles/island.css";
import "./styles/obsidian.css";
import "./styles/quick-window.css";
import { logError } from "./lib/logger";

interface EBState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError("ErrorBoundary", error.message, info.componentStack ?? error.stack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h2 style={{ fontSize: 16, marginBottom: 8, color: "var(--color-ink)" }}>应用出错</h2>
          <p style={{ fontSize: 13, color: "var(--color-ink-muted)", wordBreak: "break-all" }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{
              marginTop: 12, padding: "6px 16px", fontSize: 13, cursor: "pointer",
              background: "var(--color-signal)", color: "#fff", border: "none", borderRadius: 6,
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
