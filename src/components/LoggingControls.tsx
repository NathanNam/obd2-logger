import { useConnectionState } from "../hooks/useConnection";
import { useLoggingState } from "../hooks/useLogging";
import { logging } from "../obd/logging-session";
import { patchSettings } from "../lib/db";
import type { Storage } from "../lib/storage";
import type { Settings, Vehicle } from "../types";

type Props = {
  vehicle: Vehicle | null;
  storage: Storage;
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
};

export function LoggingControls({ vehicle, storage, settings, onSettingsChange }: Props) {
  const conn = useConnectionState();
  const state = useLoggingState();

  const canStart =
    conn.kind === "ready" && vehicle !== null && (state.kind === "idle" || state.kind === "error");
  const isLogging = state.kind === "logging";
  const isPreparing = state.kind === "preparing";

  return (
    <div className="logging-controls">
      <div className="logging-state">
        {state.kind === "idle" && (
          <div className="dim">
            {vehicle
              ? conn.kind === "ready"
                ? "Ready to log."
                : "Connect the adapter to start logging."
              : "Add a vehicle to start logging."}
          </div>
        )}
        {state.kind === "preparing" && (
          <div>
            <span className="dot busy" /> {state.step}
          </div>
        )}
        {state.kind === "logging" && (
          <div className="logging-stats mono">
            <span className="dot ok" /> Logging ·{" "}
            <strong>{state.rowCount}</strong> rows ·{" "}
            <strong>{state.meanCompletionPct.toFixed(0)}%</strong> mean PID completion
            {state.meanCompletionPct < 80 && state.rowCount > 5 && (
              <span className="warn-inline" style={{ marginLeft: 8 }}>
                ⚠ low — consider disabling expensive PIDs
              </span>
            )}
          </div>
        )}
        {state.kind === "error" && (
          <div className="callout err" style={{ margin: 0 }}>{state.message}</div>
        )}
      </div>
      <div className="spacer" />
      <label className="rate-picker mono">
        Rate:&nbsp;
        <select
          className="select"
          value={settings.sampleRateHz}
          disabled={isLogging || isPreparing}
          onChange={async (e) => {
            const hz = Number(e.target.value) as 0.5 | 1 | 2 | 5;
            const next = await patchSettings({ sampleRateHz: hz });
            onSettingsChange(next);
          }}
        >
          <option value={0.5}>0.5 Hz</option>
          <option value={1}>1 Hz</option>
          <option value={2}>2 Hz</option>
          <option value={5}>5 Hz</option>
        </select>
      </label>
      <label className="rate-picker mono">
        <input
          type="checkbox"
          checked={settings.rawCapture}
          disabled={isLogging || isPreparing}
          onChange={async (e) => {
            const next = await patchSettings({ rawCapture: e.target.checked });
            onSettingsChange(next);
          }}
        />
        &nbsp;Raw hex
      </label>
      {isLogging ? (
        <button onClick={() => void logging.stop()}>Stop</button>
      ) : (
        <button
          className="primary"
          disabled={!canStart}
          onClick={() => {
            if (!vehicle) return;
            void logging.start({
              storage,
              owner: settings.owner,
              vehicle,
              sampleRateHz: settings.sampleRateHz,
              rawMode: settings.rawCapture,
            });
          }}
        >
          {isPreparing ? "Preparing…" : "Start logging"}
        </button>
      )}
      {settings.rawCapture && !isLogging && (
        <div className="callout warn" style={{ flexBasis: "100%", margin: 0 }}>
          <strong>Raw hex mode.</strong> Profile probe is skipped — every PID is queried.
          CSV cells contain raw hex bytes (e.g. <code className="mono">0C8000</code>),
          not decoded values. Filenames are prefixed <code className="mono">raw__</code>.
          Use this for PID archaeology — correlate the bytes against known
          operating states to reverse-engineer formulas.
        </div>
      )}
    </div>
  );
}
