import { useEffect, useState } from "react";
import type { Storage } from "../lib/storage";
import {
  deleteVehicle,
  listVehicles,
  putVehicle,
  writeVehicleJson,
} from "../lib/vehicles";
import type { Settings, Vehicle } from "../types";
import { getAllProfiles, getProfile } from "../profiles/registry";
import { VehicleForm } from "./VehicleForm";

type Props = {
  settings: Settings;
  storage: Storage;
  activeSlug: string | null;
  onClose: () => void;
  onActivate: (vehicle: Vehicle) => void;
  onSettingsChange: (next: Settings) => void;
};

export function VehicleManager({
  settings,
  storage,
  activeSlug,
  onClose,
  onActivate,
  onSettingsChange,
}: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const profiles = getAllProfiles();

  async function refresh() {
    setLoading(true);
    setVehicles(await listVehicles(settings.owner));
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.owner]);

  async function handleDelete(slug: string) {
    if (!confirm(`Delete vehicle '${slug}' from the app? Files on disk are kept.`)) return;
    await deleteVehicle(slug);
    await refresh();
  }

  async function handleProfileChange(v: Vehicle, newProfileId: string) {
    if (newProfileId === v.profileId) return;
    const newProfile = getProfile(newProfileId);
    if (!newProfile) return;
    const proceed = confirm(
      `Switch '${v.displayName}' to profile '${newProfile.display_name}'?\n\n` +
        `The cached supported-PID set will be cleared, so the next time you start logging the app will re-discover standard PIDs and re-probe profile PIDs against this vehicle.`,
    );
    if (!proceed) return;
    const updated: Vehicle = {
      ...v,
      profileId: newProfile.profile_id,
      profileVersion: newProfile.profile_version,
      supportedProfilePids: [],
    };
    await putVehicle(updated);
    await writeVehicleJson(storage, updated);
    await refresh();
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="row">
          <h2 className="section-title" style={{ margin: 0 }}>Manage vehicles</h2>
          <div className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>

        {!adding && (
          <>
            {loading ? (
              <div className="dim">Loading…</div>
            ) : vehicles.length === 0 ? (
              <div className="placeholder">No vehicles yet for owner '{settings.owner}'.</div>
            ) : (
              <div className="vehicle-list">
                {vehicles.map((v) => (
                  <div
                    key={v.slug}
                    className={`vehicle-row ${activeSlug === v.slug ? "active" : ""}`}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="vehicle-name">{v.displayName}</div>
                      <div className="vehicle-meta mono">{v.slug}</div>
                      <div className="row" style={{ gap: 6, marginTop: 6 }}>
                        <span className="dim" style={{ fontSize: 11 }}>Profile</span>
                        <select
                          className="select"
                          value={v.profileId}
                          onChange={(e) => void handleProfileChange(v, e.target.value)}
                          style={{ fontSize: 12, padding: "3px 6px" }}
                        >
                          {profiles.map((p) => (
                            <option key={p.profile_id} value={p.profile_id}>
                              {p.display_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {activeSlug === v.slug ? (
                      <span className="badge ok">ACTIVE</span>
                    ) : (
                      <button onClick={() => onActivate(v)}>Activate</button>
                    )}
                    <button
                      onClick={() => void handleDelete(v.slug)}
                      title="Remove from app (files on disk are kept)"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <div className="spacer" />
              <button className="primary" onClick={() => setAdding(true)}>
                Add vehicle…
              </button>
            </div>
          </>
        )}

        {adding && (
          <VehicleForm
            settings={settings}
            storage={storage}
            existingSlugs={vehicles.map((v) => v.slug)}
            onCancel={() => setAdding(false)}
            onSettingsChange={onSettingsChange}
            onCreated={async (v) => {
              setAdding(false);
              await refresh();
              onActivate(v);
            }}
          />
        )}
      </div>
    </div>
  );
}
