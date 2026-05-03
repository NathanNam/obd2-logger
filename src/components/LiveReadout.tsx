import { useEffect, useMemo, useRef, useState } from "react";
import { logging } from "../obd/logging-session";
import type { LiveValue } from "../obd/sampler";
import { buildRegistry, type RegistryEntry } from "../obd/registry-builder";
import { getProfile } from "../profiles/registry";
import type { PidCategory, PidDef } from "../profiles/types";
import type { Vehicle } from "../types";
import { Sparkline } from "./Sparkline";

const HISTORY_LEN = 60;

type Props = {
  vehicle: Vehicle | null;
};

const CATEGORY_LABELS: Record<PidCategory, string> = {
  engine: "Engine",
  hybrid: "Hybrid",
  battery: "Battery",
  transmission: "Transmission",
  emissions: "Emissions",
  diagnostics: "Diagnostics",
  other: "Other",
};

const DEFAULT_OPEN: PidCategory[] = ["engine", "hybrid"];

export function LiveReadout({ vehicle }: Props) {
  const [filter, setFilter] = useState("");
  const [openCats, setOpenCats] = useState<Set<PidCategory>>(new Set(DEFAULT_OPEN));
  const [latest, setLatest] = useState<Record<string, number>>({});
  const historyRef = useRef<Record<string, number[]>>({});
  const [, forceRender] = useState(0);

  useEffect(() => {
    historyRef.current = {};
    setLatest({});
    if (!vehicle) return;
    const off = logging.onValue((v: LiveValue) => {
      setLatest((prev) => ({ ...prev, [v.id]: v.value }));
      const arr = historyRef.current[v.id] ?? [];
      arr.push(v.value);
      if (arr.length > HISTORY_LEN) arr.shift();
      historyRef.current[v.id] = arr;
    });
    const interval = setInterval(() => forceRender((n) => n + 1), 500);
    return () => {
      off();
      clearInterval(interval);
    };
  }, [vehicle]);

  const registry = useMemo<RegistryEntry[]>(() => {
    if (!vehicle) return [];
    const profile = getProfile(vehicle.profileId);
    if (!profile) return [];
    return buildRegistry({
      profile,
      supportedStandardPids: vehicle.supportedStandardPids,
      supportedProfilePids: vehicle.supportedProfilePids,
      vehicle,
    });
  }, [vehicle]);

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out = new Map<PidCategory, RegistryEntry[]>();
    for (const e of registry) {
      if (!e.enabled) continue;
      if (
        f &&
        !e.def.id.toLowerCase().includes(f) &&
        !e.def.display_name.toLowerCase().includes(f)
      )
        continue;
      const list = out.get(e.def.category) ?? [];
      list.push(e);
      out.set(e.def.category, list);
    }
    return out;
  }, [registry, filter]);

  if (!vehicle) {
    return (
      <div className="placeholder">
        Select or add a vehicle to see its supported PIDs.
      </div>
    );
  }

  if (registry.length === 0) {
    return (
      <div className="placeholder">
        Connect the adapter and click <strong>Start logging</strong> to discover
        this vehicle's supported PIDs. They'll show up here.
      </div>
    );
  }

  const categoryEntries = Array.from(grouped.entries()).sort(
    (a, b) => orderOf(a[0]) - orderOf(b[0]),
  );

  return (
    <div className="readout">
      <div className="readout-toolbar">
        <input
          type="text"
          placeholder="Filter PIDs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="dim mono">
          {registry.filter((e) => e.enabled).length} enabled
        </span>
      </div>
      {categoryEntries.length === 0 && (
        <div className="placeholder">No PIDs match your filter.</div>
      )}
      {categoryEntries.map(([cat, entries]) => {
        const isOpen = openCats.has(cat);
        return (
          <div key={cat} className="readout-section">
            <button
              className="cat-header"
              onClick={() => {
                setOpenCats((prev) => {
                  const next = new Set(prev);
                  if (next.has(cat)) next.delete(cat);
                  else next.add(cat);
                  return next;
                });
              }}
            >
              <span className="cat-caret">{isOpen ? "▾" : "▸"}</span>
              {CATEGORY_LABELS[cat]} <span className="dim mono">({entries.length})</span>
            </button>
            {isOpen && (
              <div className="cat-grid">
                {entries.map((e) => (
                  <PidCard
                    key={e.def.id}
                    def={e.def}
                    value={latest[e.def.id]}
                    history={historyRef.current[e.def.id] ?? []}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PidCard({
  def,
  value,
  history,
}: {
  def: PidDef;
  value: number | undefined;
  history: number[];
}) {
  return (
    <div className="pid-card">
      <div className="pid-name" title={def.id}>{def.display_name}</div>
      <div className="pid-row">
        <div className="pid-value mono">
          {value === undefined ? "—" : formatNumber(value)}
          <span className="pid-unit">{def.unit}</span>
        </div>
        <Sparkline values={history} />
      </div>
    </div>
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function orderOf(c: PidCategory): number {
  return { engine: 0, hybrid: 1, battery: 2, transmission: 3, emissions: 4, diagnostics: 5, other: 6 }[c] ?? 99;
}
