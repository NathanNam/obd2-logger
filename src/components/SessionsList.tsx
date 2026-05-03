import { useEffect, useState } from "react";
import { readSessionsJsonl, type SessionRecord } from "../lib/sessions";
import type { Storage } from "../lib/storage";
import { sessionsJsonlPath } from "../lib/vehicles";
import { useLoggingState } from "../hooks/useLogging";
import type { Vehicle } from "../types";

type Props = {
  vehicle: Vehicle | null;
  owner: string;
  storage: Storage;
};

export function SessionsList({ vehicle, owner, storage }: Props) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const loggingState = useLoggingState();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!vehicle) {
        setSessions([]);
        return;
      }
      setLoading(true);
      try {
        const list = await readSessionsJsonl(
          storage,
          sessionsJsonlPath(owner, vehicle.slug),
        );
        if (!cancelled) {
          list.sort((a, b) => b.start_utc.localeCompare(a.start_utc));
          setSessions(list);
        }
      } catch {
        if (!cancelled) setSessions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [vehicle, owner, storage, loggingState.kind]);

  if (!vehicle) return <div className="placeholder">Select a vehicle to see its sessions.</div>;
  if (loading) return <div className="dim">Loading…</div>;
  if (sessions.length === 0)
    return <div className="placeholder">No sessions yet for this vehicle.</div>;

  return (
    <div className="session-table">
      <div className="session-row session-head mono">
        <span>Started</span>
        <span>Duration</span>
        <span>Rows</span>
        <span>PIDs</span>
        <span>Mean %</span>
        <span>Reason</span>
        <span>File</span>
      </div>
      {sessions.map((s) => (
        <div key={s.session_id} className="session-row mono">
          <span>{s.start_utc.replace(".000Z", "Z")}</span>
          <span>{formatDuration(s.duration_ms)}</span>
          <span>{s.row_count}</span>
          <span>{s.pid_count}</span>
          <span>{s.mean_pid_completion_pct.toFixed(0)}</span>
          <span className="dim">{s.ended_reason}</span>
          <span className="dim" title={s.file}>{s.file.split("/").pop()}</span>
        </div>
      ))}
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
