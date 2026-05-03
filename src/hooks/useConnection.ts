import { useEffect, useState } from "react";
import { connection, type ConnectionState } from "../obd/connection";
import type { LogEntry } from "../obd/elm327";

export function useConnectionState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>(connection.getState());
  useEffect(() => connection.onState(setState), []);
  return state;
}

const MAX_LOG = 200;

export function useConnectionLog(): LogEntry[] {
  const [log, setLog] = useState<LogEntry[]>([]);
  useEffect(
    () =>
      connection.onLog((e) => {
        setLog((prev) => {
          const next = prev.length >= MAX_LOG ? prev.slice(1) : prev.slice();
          next.push(e);
          return next;
        });
      }),
    [],
  );
  return log;
}
