import { useEffect, useState } from "react";
import { logging, type LoggingState } from "../obd/logging-session";

export function useLoggingState(): LoggingState {
  const [state, setState] = useState<LoggingState>(logging.getState());
  useEffect(() => logging.onState(setState), []);
  return state;
}
