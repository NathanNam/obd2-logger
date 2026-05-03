import { useMemo, useRef, useState } from "react";
import { useConnectionState } from "../hooks/useConnection";
import type { Storage } from "../lib/storage";
import {
  runSweepForActiveVehicle,
  type ModeRange,
  type SweepProgress,
  type SweepReport,
} from "../obd/sweep";
import { triggerDownload } from "../profiles/disk";
import { getProfile } from "../profiles/registry";
import type { Settings, Vehicle } from "../types";

type Props = {
  vehicle: Vehicle | null;
  storage: Storage;
  settings: Settings;
};

export function SweepPanel({ vehicle, storage, settings }: Props) {
  const conn = useConnectionState();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SweepProgress | null>(null);
  const [report, setReport] = useState<SweepReport | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeMode21, setIncludeMode21] = useState(true);
  const [includeMode22, setIncludeMode22] = useState(false);
  const [m22StartHex, setM22StartHex] = useState("0100");
  const [m22EndHex, setM22EndHex] = useState("01FF");
  const [showAll, setShowAll] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ready = conn.kind === "ready";
  const canRun = ready && vehicle && !running;

  const m22Start = parseHex(m22StartHex);
  const m22End = parseHex(m22EndHex);
  const m22Valid =
    m22Start !== null &&
    m22End !== null &&
    m22Start >= 0 &&
    m22End >= m22Start &&
    m22End <= 0xffff;

  const modeRanges = useMemo<ModeRange[]>(() => {
    const out: ModeRange[] = [];
    if (includeMode21) out.push({ mode: "21", pidStart: 0x00, pidEnd: 0xff });
    if (includeMode22 && m22Valid)
      out.push({ mode: "22", pidStart: m22Start!, pidEnd: m22End! });
    return out;
  }, [includeMode21, includeMode22, m22Start, m22End, m22Valid]);

  const profile = vehicle ? getProfile(vehicle.profileId) : null;
  const ecus = profile ? Object.keys(profile.ecus) : [];
  const totalEstimate =
    ecus.length *
    modeRanges.reduce((s, r) => s + (r.pidEnd - r.pidStart + 1), 0);
  const estSeconds = Math.round(totalEstimate * 0.15);
  const estTime =
    estSeconds < 90
      ? `${estSeconds}s`
      : `${Math.floor(estSeconds / 60)}m ${estSeconds % 60}s`;

  async function start() {
    if (!vehicle) return;
    const profile = getProfile(vehicle.profileId);
    const ecus = profile
      ? Object.entries(profile.ecus).map(([name, e]) => ({
          name,
          request_header: e.request_header,
          response_header: e.response_header,
        }))
      : [];
    if (ecus.length === 0) {
      setError(
        "No ECUs declared in the active profile. Sweep needs at least one ECU header — switch to a profile that declares them.",
      );
      return;
    }
    if (modeRanges.length === 0) {
      setError("Pick at least one mode and a valid PID range.");
      return;
    }
    setRunning(true);
    setError(null);
    setReport(null);
    setFilename(null);
    setSaveError(null);
    setProgress(null);
    abortRef.current = new AbortController();
    try {
      const result = await runSweepForActiveVehicle({
        storage,
        owner: settings.owner,
        vehicleSlug: vehicle.slug,
        profileId: vehicle.profileId,
        vin: vehicle.vin,
        ecus,
        modeRanges,
        onProgress: setProgress,
        abortSignal: abortRef.current.signal,
      });
      setReport(result.report);
      setFilename(result.filename);
      setSaveError(result.saveError);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function downloadReport() {
    if (!report || !filename) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, filename);
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const responsive = report
    ? report.responses.filter((r) => r.status === "ok")
    : [];
  const visible = showAll ? report?.responses ?? [] : responsive;

  return (
    <div className="conn-card">
      <div className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Sweep PIDs
          </div>
          <div className="dim" style={{ fontSize: 12 }}>
            Iterates PIDs across every ECU declared in the active profile. Park the
            vehicle in ACC or ON, then run. Results land in{" "}
            <code className="mono">
              data/{settings.owner}/{vehicle?.slug ?? "&lt;slug&gt;"}/sessions/sweep__*.json
            </code>
            .
          </div>
        </div>
        {running ? (
          <button onClick={cancel}>Cancel</button>
        ) : (
          <button
            className="primary"
            disabled={!canRun || modeRanges.length === 0}
            onClick={() => void start()}
          >
            Start sweep
          </button>
        )}
      </div>

      <div className="sweep-modes" style={{ marginTop: 10 }}>
        <label className="mono" style={{ fontSize: 12, display: "flex", gap: 6 }}>
          <input
            type="checkbox"
            checked={includeMode21}
            disabled={running}
            onChange={(e) => setIncludeMode21(e.target.checked)}
          />
          <span>
            <strong>Mode 21</strong> · 1-byte PIDs · 00–FF (256/ECU)
          </span>
        </label>
        <label className="mono" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="checkbox"
            checked={includeMode22}
            disabled={running}
            onChange={(e) => setIncludeMode22(e.target.checked)}
          />
          <span>
            <strong>Mode 22</strong> · 2-byte DIDs · range
          </span>
          <input
            type="text"
            value={m22StartHex}
            disabled={running || !includeMode22}
            onChange={(e) => setM22StartHex(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
            spellCheck={false}
            style={{ width: 70, fontFamily: "var(--mono)", fontSize: 12 }}
            placeholder="0100"
          />
          <span>–</span>
          <input
            type="text"
            value={m22EndHex}
            disabled={running || !includeMode22}
            onChange={(e) => setM22EndHex(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
            spellCheck={false}
            style={{ width: 70, fontFamily: "var(--mono)", fontSize: 12 }}
            placeholder="01FF"
          />
          {includeMode22 && !m22Valid && (
            <span className="warn-inline" style={{ fontSize: 11 }}>
              invalid range
            </span>
          )}
          {includeMode22 && m22Valid && (
            <span className="dim" style={{ fontSize: 11 }}>
              {m22End! - m22Start! + 1} DIDs/ECU
            </span>
          )}
        </label>
      </div>

      {!running && !report && !error && vehicle && profile && modeRanges.length > 0 && (
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          ETA ~{estTime}. Will query {totalEstimate.toLocaleString()} (PID, ECU, mode)
          tuples across {ecus.length === 0 ? "(no ECUs in profile)" : ecus.join(", ")}.
        </div>
      )}

      {progress && (
        <div style={{ marginTop: 10 }}>
          <div className="mono" style={{ fontSize: 12, marginBottom: 4 }}>
            {progress.current.toLocaleString()} / {progress.total.toLocaleString()} ·{" "}
            <span className="dim">{progress.ecu}</span> · PID {progress.pid} ·{" "}
            <span style={{ color: "var(--ok)" }}>{progress.responsive} responding</span>
          </div>
          <div className="progress">
            <div
              className="progress-bar"
              style={{
                width: `${(progress.current / Math.max(1, progress.total)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {error && <div className="callout err" style={{ marginTop: 10 }}>{error}</div>}

      {report && (
        <div style={{ marginTop: 14 }}>
          {saveError ? (
            <div className="callout warn" style={{ marginBottom: 10 }}>
              <strong>Save to disk failed:</strong>{" "}
              <span className="mono" style={{ fontSize: 12 }}>{saveError}</span>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                Sweep data is still in memory below. Click <strong>Download JSON</strong>{" "}
                to save it via your browser's download dialog. Then drop the file
                into <code className="mono">data/{settings.owner}/{report.vehicle_slug}/sessions/</code>{" "}
                manually if you want it co-located with your other sessions.
              </div>
              <div style={{ marginTop: 8 }}>
                <button className="primary" onClick={downloadReport}>
                  Download {filename}
                </button>
              </div>
            </div>
          ) : null}
          <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
            <div className="mono" style={{ fontSize: 13 }}>
              {report.responsive_count} / {report.pid_count} PIDs responded
            </div>
            <div className="dim mono" style={{ fontSize: 11 }}>
              {saveError
                ? "(not saved to disk — see above)"
                : `Saved to ${report.vehicle_slug}/sessions/${filename}`}
            </div>
            <div className="spacer" />
            <label className="mono" style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              &nbsp;Show non-responding too
            </label>
          </div>
          <div className="sweep-grid">
            <div className="sweep-row sweep-head mono">
              <span>ECU</span>
              <span>Mode</span>
              <span>PID</span>
              <span>Status</span>
              <span>Bytes</span>
              <span>Response (hex)</span>
            </div>
            {visible.slice(0, 500).map((r, i) => (
              <div key={i} className={`sweep-row mono status-${r.status}`}>
                <span>{r.ecu}</span>
                <span>{r.mode}</span>
                <span>{r.pid}</span>
                <span>
                  {r.status === "rejected" && r.nrc_name
                    ? `rejected · ${r.nrc_name}`
                    : r.status}
                </span>
                <span>{r.byte_count ?? "—"}</span>
                <span>
                  {r.response_hex ??
                    (r.status === "rejected" && r.nrc_code
                      ? `7F${r.mode}${r.nrc_code}`
                      : r.errors?.join(",") || "—")}
                </span>
              </div>
            ))}
            {visible.length > 500 && (
              <div className="dim" style={{ fontSize: 11, padding: "6px 10px" }}>
                Showing first 500 of {visible.length}. Full list is in the JSON file.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function parseHex(s: string): number | null {
  if (!s) return null;
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  const n = parseInt(s, 16);
  return Number.isFinite(n) ? n : null;
}
