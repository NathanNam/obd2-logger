import { useMemo } from "react";
import { useConnectionLog, useConnectionState } from "../hooks/useConnection";
import { connection, type ConnectionState } from "../obd/connection";

export function ConnectionPanel() {
  const state = useConnectionState();
  const log = useConnectionLog();

  const status = useMemo(() => describe(state), [state]);
  const busy = isBusy(state);
  const connected = state.kind === "ready" || state.kind === "logging";
  const showConnect = state.kind === "disconnected" || state.kind === "error";

  return (
    <div className="conn-card">
      <div className="conn-row">
        <div className="conn-status">
          <span className={`dot ${statusClass(state)}`} aria-hidden />
          <div>
            <div className="conn-state mono">{status.title}</div>
            <div className="conn-detail">{status.detail}</div>
          </div>
        </div>
        <div className="spacer" />
        <div className="conn-meta">
          {state.kind === "ready" && <span className="badge ok">READY</span>}
        </div>
        {showConnect ? (
          <button
            className="primary"
            onClick={() => void connection.connect()}
            disabled={busy}
          >
            Connect adapter…
          </button>
        ) : (
          <button
            onClick={() => void connection.disconnect()}
            disabled={!connected && state.kind !== "initializing"}
          >
            Disconnect
          </button>
        )}
      </div>
      {state.kind === "error" && (
        <div className="callout err" style={{ marginTop: 12 }}>
          {state.message}
        </div>
      )}
      <details className="conn-log">
        <summary>
          Adapter log <span className="dim mono">({log.length})</span>
        </summary>
        <div className="conn-log-body mono">
          {log.length === 0 ? (
            <div className="dim">No traffic yet.</div>
          ) : (
            log.map((entry, i) => (
              <div key={i} className={`logline dir-${entry.direction}`}>
                <span className="logline-dir">
                  {entry.direction.toUpperCase().padEnd(4, " ")}
                </span>
                <span className="logline-text">{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </details>
    </div>
  );
}

function describe(state: ConnectionState): { title: string; detail: string } {
  switch (state.kind) {
    case "disconnected":
      return { title: "disconnected", detail: "No adapter connected." };
    case "connecting":
      return { title: "connecting", detail: state.label };
    case "initializing":
      return { title: "initializing", detail: `${state.label} · ELM327 init` };
    case "reading_vin":
      return { title: "reading VIN", detail: state.label };
    case "discovering_pids":
      return { title: "discovering PIDs", detail: state.label };
    case "ready":
      return { title: "ready", detail: state.label };
    case "logging":
      return { title: "logging", detail: state.label };
    case "reconnecting":
      return {
        title: "reconnecting",
        detail: `${state.label} · attempt ${state.attempt}/${state.maxAttempts}`,
      };
    case "error":
      return { title: "error", detail: state.label };
  }
}

function statusClass(state: ConnectionState): string {
  switch (state.kind) {
    case "disconnected":
      return "off";
    case "ready":
    case "logging":
      return "ok";
    case "error":
      return "err";
    case "reconnecting":
      return "warn";
    default:
      return "busy";
  }
}

function isBusy(state: ConnectionState): boolean {
  return (
    state.kind === "connecting" ||
    state.kind === "initializing" ||
    state.kind === "reading_vin" ||
    state.kind === "discovering_pids" ||
    state.kind === "reconnecting"
  );
}
