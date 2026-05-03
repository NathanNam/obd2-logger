import { useEffect, useRef, useState } from "react";
import { patchSettings } from "../lib/db";
import { exportData } from "../lib/export";
import { renameOwnerDir } from "../lib/fs";
import { listVehicles, putVehicle } from "../lib/vehicles";
import { exportProfile, importProfileFromFile } from "../profiles/disk";
import { getAllProfiles } from "../profiles/registry";
import { isValidOwner, normalizeOwner, ownerError } from "../lib/owner";
import type { Settings as AppSettings, Vehicle } from "../types";

type Props = {
  settings: AppSettings;
  rootDir: FileSystemDirectoryHandle;
  onClose: () => void;
  onSettingsChange: (next: AppSettings) => void;
};

export function Settings({ settings, rootDir, onClose, onSettingsChange }: Props) {
  const [ownerDraft, setOwnerDraft] = useState(settings.owner);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameMsg, setRenameMsg] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listVehicles(settings.owner).then(setVehicles);
  }, [settings.owner]);

  async function handleRenameOwner() {
    const next = normalizeOwner(ownerDraft);
    if (next === settings.owner) {
      setRenameMsg("Same as current owner.");
      return;
    }
    if (!isValidOwner(next)) {
      setRenameMsg(ownerError(next) ?? "Invalid owner.");
      return;
    }
    if (
      !confirm(
        `Rename owner from '${settings.owner}' to '${next}'?\n\n` +
          `This will rename data/${settings.owner}/ → data/${next}/ on disk and update all vehicle records.`,
      )
    ) {
      return;
    }
    setRenameBusy(true);
    setRenameMsg(null);
    try {
      await renameOwnerDir(rootDir, settings.owner, next);
      for (const v of vehicles) {
        await putVehicle({ ...v, owner: next });
      }
      const updated = await patchSettings({ owner: next });
      onSettingsChange(updated);
      setRenameMsg(`Renamed to '${next}'.`);
    } catch (e) {
      setRenameMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleToggleDecode(value: boolean) {
    const next = await patchSettings({ autoDecodeVin: value });
    onSettingsChange(next);
  }

  async function handleExport(scope: "owner" | string) {
    setExportBusy(true);
    setExportMsg(null);
    try {
      const result =
        scope === "owner"
          ? await exportData(rootDir, { kind: "owner", owner: settings.owner })
          : await exportData(rootDir, {
              kind: "vehicle",
              owner: settings.owner,
              slug: scope,
            });
      setExportMsg(
        `Exported ${result.filename} (${(result.bytes / 1024).toFixed(1)} KB).`,
      );
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }

  async function handleImportProfile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg(null);
    try {
      const profile = await importProfileFromFile(rootDir, file);
      setImportMsg(`Imported '${profile.profile_id}'.`);
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 640 }}>
        <div className="row">
          <h2 className="section-title" style={{ margin: 0 }}>Settings</h2>
          <div className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>

        <section className="settings-section">
          <h3>Owner</h3>
          <p className="dim" style={{ marginTop: 0 }}>
            Used as the top-level folder name under <code>data/</code>.
          </p>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Current</label>
              <input
                type="text"
                value={ownerDraft}
                onChange={(e) => setOwnerDraft(e.target.value)}
                onBlur={(e) => setOwnerDraft(normalizeOwner(e.target.value))}
              />
            </div>
            <button onClick={() => void handleRenameOwner()} disabled={renameBusy}>
              {renameBusy ? "Renaming…" : "Rename owner"}
            </button>
          </div>
          {renameMsg && <div className="dim" style={{ marginTop: 6 }}>{renameMsg}</div>}
        </section>

        <section className="settings-section">
          <h3>VIN auto-decode</h3>
          <label className="row" style={{ gap: 10 }}>
            <input
              type="checkbox"
              checked={settings.autoDecodeVin}
              onChange={(e) => void handleToggleDecode(e.target.checked)}
            />
            <span>Decode the VIN via NHTSA's free public API when adding a vehicle.</span>
          </label>
          <p className="dim" style={{ marginTop: 6 }}>
            This is the only outbound network request the app makes besides loading
            itself. Disable to keep all VIN data local.
          </p>
        </section>

        <section className="settings-section">
          <h3>Profiles</h3>
          <p className="dim" style={{ marginTop: 0 }}>
            Built-in profiles are written to <code>profiles/</code>. Imported profiles
            join them and appear in the vehicle profile dropdown.
          </p>
          <div className="row" style={{ marginBottom: 8 }}>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleImportProfile(e)}
            />
          </div>
          {importMsg && <div className="dim">{importMsg}</div>}
          <ProfileExportList />
        </section>

        <section className="settings-section">
          <h3>Export your data</h3>
          <p className="dim" style={{ marginTop: 0 }}>
            Bundle <code>data/{settings.owner}/</code> as a zip you can hand to a
            friend. Place their <code>data/&lt;their-owner&gt;/</code> in your{" "}
            <code>data/</code> to receive theirs back.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <button
              className="primary"
              onClick={() => void handleExport("owner")}
              disabled={exportBusy}
            >
              {exportBusy ? "Building zip…" : "Export all my data as zip"}
            </button>
            {vehicles.map((v) => (
              <button
                key={v.slug}
                onClick={() => void handleExport(v.slug)}
                disabled={exportBusy}
              >
                Just {v.slug}
              </button>
            ))}
          </div>
          {exportMsg && <div className="dim" style={{ marginTop: 6 }}>{exportMsg}</div>}
        </section>
      </div>
    </div>
  );
}

function ProfileExportList() {
  const profiles = getAllProfiles();
  return (
    <div className="profile-list">
      {profiles.map((p) => (
        <div key={p.profile_id} className="profile-row">
          <div>
            <div className="mono" style={{ fontSize: 12 }}>{p.profile_id}</div>
            <div className="dim" style={{ fontSize: 11 }}>{p.display_name}</div>
          </div>
          <div className="spacer" />
          <button onClick={() => void exportProfile(p)}>Export</button>
        </div>
      ))}
    </div>
  );
}
