import { useEffect, useState } from "react";
import { patchSettings } from "../lib/db";
import { getVehicle, listVehicles } from "../lib/vehicles";
import { getProfile } from "../profiles/registry";
import type { Settings, Vehicle } from "../types";
import { ConnectionPanel } from "./ConnectionPanel";
import { LiveReadout } from "./LiveReadout";
import { LoggingControls } from "./LoggingControls";
import { SessionsList } from "./SessionsList";
import { Settings as SettingsPanel } from "./Settings";
import { SweepPanel } from "./SweepPanel";
import { VehicleManager } from "./VehicleManager";

type Props = {
  settings: Settings;
  rootDir: FileSystemDirectoryHandle;
  rootName: string;
  onResetData: () => void;
  onSettingsChange: (next: Settings) => void;
};

export function MainShell({
  settings,
  rootDir,
  rootName,
  onResetData,
  onSettingsChange,
}: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [active, setActive] = useState<Vehicle | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function refresh() {
    const all = await listVehicles(settings.owner);
    setVehicles(all);
    const slug = settings.activeVehicleSlug;
    if (slug) {
      const found = all.find((v) => v.slug === slug);
      setActive(found ?? null);
      if (!found && all.length > 0) {
        const first = all[0];
        setActive(first);
        const next = await patchSettings({ activeVehicleSlug: first.slug });
        onSettingsChange(next);
      }
    } else if (all.length > 0) {
      setActive(all[0]);
      const next = await patchSettings({ activeVehicleSlug: all[0].slug });
      onSettingsChange(next);
    } else {
      setActive(null);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.owner, settings.activeVehicleSlug]);

  async function handleActivate(slug: string) {
    const v = await getVehicle(slug);
    if (!v) return;
    setActive(v);
    const next = await patchSettings({ activeVehicleSlug: slug });
    onSettingsChange(next);
  }

  return (
    <>
      <header className="appheader">
        <div className="brand">
          obd2<span className="tag">/logger</span>
        </div>
        <div className="meta">owner: {settings.owner}</div>
        <div className="meta">root: {rootName}</div>
        <div className="spacer" />
        <select
          value={active?.slug ?? ""}
          onChange={(e) => void handleActivate(e.target.value)}
          className="select"
          disabled={vehicles.length === 0}
        >
          {vehicles.length === 0 && <option value="">No vehicles</option>}
          {vehicles.map((v) => (
            <option key={v.slug} value={v.slug}>
              {v.displayName}
            </option>
          ))}
        </select>
        <button onClick={() => setManagerOpen(true)}>Manage vehicles</button>
        <button onClick={() => setSettingsOpen(true)}>Settings</button>
        <button onClick={onResetData} title="Forget folder + settings (dev)">
          Reset
        </button>
      </header>
      <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
        <section>
          <h2 className="section-title">Active vehicle</h2>
          {active ? (
            <ActiveVehicleCard vehicle={active} />
          ) : (
            <div className="placeholder">
              No vehicles yet. Click <strong>Manage vehicles</strong> to add one.
            </div>
          )}
        </section>
        <section>
          <h2 className="section-title">Connection</h2>
          <ConnectionPanel />
        </section>
        <section>
          <h2 className="section-title">Logging</h2>
          <LoggingControls
            vehicle={active}
            rootDir={rootDir}
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        </section>
        <section>
          <h2 className="section-title">PID sweep (archaeology)</h2>
          <SweepPanel vehicle={active} rootDir={rootDir} settings={settings} />
        </section>
        <section>
          <h2 className="section-title">Live readout</h2>
          <LiveReadout vehicle={active} />
        </section>
        <section>
          <h2 className="section-title">Sessions</h2>
          <SessionsList vehicle={active} owner={settings.owner} rootDir={rootDir} />
        </section>
      </main>
      {managerOpen && (
        <VehicleManager
          settings={settings}
          rootDir={rootDir}
          activeSlug={active?.slug ?? null}
          onClose={() => {
            setManagerOpen(false);
            void refresh();
          }}
          onActivate={async (v) => {
            await handleActivate(v.slug);
            setManagerOpen(false);
          }}
          onSettingsChange={onSettingsChange}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          rootDir={rootDir}
          onClose={() => {
            setSettingsOpen(false);
            void refresh();
          }}
          onSettingsChange={onSettingsChange}
        />
      )}
    </>
  );
}

function ActiveVehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const profile = getProfile(vehicle.profileId);
  return (
    <div className="vehicle-card">
      <div className="vehicle-name">{vehicle.displayName}</div>
      <div className="mono dim" style={{ fontSize: 12 }}>
        {vehicle.slug} · {profile?.display_name ?? vehicle.profileId}
        {vehicle.vin ? ` · VIN ${vehicle.vin}` : ""}
      </div>
    </div>
  );
}
