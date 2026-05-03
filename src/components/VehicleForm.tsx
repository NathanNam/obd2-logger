import { useEffect, useMemo, useRef, useState } from "react";
import { patchSettings } from "../lib/db";
import { decodeVin, type NhtsaResult } from "../lib/nhtsa";
import {
  buildDisplayName,
  buildSlug,
  ensureSessionsDir,
  putVehicle,
  writeVehicleJson,
} from "../lib/vehicles";
import { ensureOwnerDir } from "../lib/fs";
import { connection } from "../obd/connection";
import { getAllProfiles, suggestProfileFor } from "../profiles/registry";
import type { Settings, Vehicle } from "../types";

type Props = {
  settings: Settings;
  rootDir: FileSystemDirectoryHandle;
  onCreated: (vehicle: Vehicle) => void;
  onCancel: () => void;
  onSettingsChange: (next: Settings) => void;
  existingSlugs: string[];
};

type DecodeStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; result: NhtsaResult & { ok: true } }
  | { kind: "skipped" }
  | { kind: "error"; message: string };

export function VehicleForm({
  settings,
  rootDir,
  onCreated,
  onCancel,
  onSettingsChange,
  existingSlugs,
}: Props) {
  const [vin, setVin] = useState("");
  const [vinReadFailed, setVinReadFailed] = useState(false);
  const [readingVin, setReadingVin] = useState(false);

  const [decode, setDecode] = useState<DecodeStatus>({ kind: "idle" });
  const decodeAbort = useRef<AbortController | null>(null);

  const [year, setYear] = useState<string>("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [profileId, setProfileId] = useState("generic-obd2");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const profiles = useMemo(() => getAllProfiles(), []);

  useEffect(() => {
    void runVinRead();
    return () => {
      decodeAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runVinRead() {
    if (connection.getState().kind !== "ready") return;
    setReadingVin(true);
    try {
      const v = await connection.readVin();
      if (v) {
        setVin(v);
        if (settings.autoDecodeVin) {
          void runDecode(v);
        }
      } else {
        setVinReadFailed(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setVinReadFailed(true);
    } finally {
      setReadingVin(false);
    }
  }

  async function runDecode(vinValue: string) {
    decodeAbort.current?.abort();
    const ctrl = new AbortController();
    decodeAbort.current = ctrl;
    setDecode({ kind: "running" });
    if (!settings.nhtsaDisclosureSeen) {
      const next = await patchSettings({ nhtsaDisclosureSeen: true });
      onSettingsChange(next);
    }
    const result = await decodeVin(vinValue, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (!result.ok) {
      if (result.error === "aborted") return;
      setDecode({ kind: "error", message: result.error });
      return;
    }
    setDecode({ kind: "ok", result });
    setYear(result.year ? String(result.year) : "");
    setMake(result.make);
    setModel(result.model);
    setTrim(result.trim);
    const name = buildDisplayName({
      year: result.year,
      make: result.make,
      model: result.model,
      trim: result.trim,
    });
    setDisplayName(name);
    if (!slugTouched) {
      setSlug(buildSlug({ year: result.year, make: result.make, model: result.model }));
    }
    const suggested = suggestProfileFor({
      make: result.make,
      model: result.model,
      year: result.year,
    });
    setProfileId(suggested.profile_id);
  }

  function handleSkipDecode() {
    decodeAbort.current?.abort();
    setDecode({ kind: "skipped" });
  }

  async function handleDisableDecode() {
    handleSkipDecode();
    const next = await patchSettings({ autoDecodeVin: false });
    onSettingsChange(next);
  }

  function syncSlugFromFields(yr: string, mk: string, mdl: string) {
    if (slugTouched) return;
    const yrNum = yr ? parseInt(yr, 10) : null;
    setSlug(buildSlug({ year: yrNum, make: mk, model: mdl }));
  }

  async function handleSave() {
    setErr(null);
    if (!slug) {
      setErr("Slug is required.");
      return;
    }
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      setErr("Slug must be lowercase, kebab-case ASCII.");
      return;
    }
    if (existingSlugs.includes(slug)) {
      setErr(`Slug '${slug}' already exists for this owner. Pick a different one.`);
      return;
    }
    if (!displayName.trim()) {
      setErr("Display name is required.");
      return;
    }
    setBusy(true);
    try {
      const yrNum = year ? parseInt(year, 10) : null;
      const profile = profiles.find((p) => p.profile_id === profileId)!;
      const now = new Date().toISOString();
      const vehicle: Vehicle = {
        slug,
        owner: settings.owner,
        displayName: displayName.trim(),
        year: yrNum && Number.isFinite(yrNum) ? yrNum : null,
        make: make.trim(),
        model: model.trim(),
        trim: trim.trim(),
        vin: vin || null,
        notes: notes.trim(),
        profileId,
        profileVersion: profile.profile_version,
        createdAtUtc: now,
        lastUsedUtc: null,
        supportedStandardPids: [],
        supportedProfilePids: [],
        disabledPids: [],
      };
      await putVehicle(vehicle);
      const ownerDir = await ensureOwnerDir(rootDir, settings.owner);
      const decoded =
        decode.kind === "ok"
          ? {
              source: "nhtsa_vpic" as const,
              decoded_at_utc: new Date().toISOString(),
              raw_response_excerpt: decode.result.raw as unknown as Record<
                string,
                string | null
              >,
            }
          : undefined;
      await writeVehicleJson(
        ownerDir,
        vehicle,
        decoded,
        decode.kind === "skipped" ? true : decode.kind === "ok" ? false : undefined,
      );
      await ensureSessionsDir(ownerDir, vehicle.slug);
      onCreated(vehicle);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const isHybrid = useMemo(() => {
    if (decode.kind !== "ok") return false;
    const fuel2 = decode.result.raw.FuelTypeSecondary?.toLowerCase() ?? "";
    return fuel2.includes("electric");
  }, [decode]);

  return (
    <div className="vehicle-form">
      <h2 className="section-title" style={{ marginBottom: 6 }}>Add a vehicle</h2>
      <p className="dim" style={{ marginTop: 0 }}>
        Reading VIN from the ECU and pre-filling Year / Make / Model from
        NHTSA where possible. You can edit any field.
      </p>

      <div className="vin-row">
        <div className="field" style={{ marginBottom: 0, flex: 1 }}>
          <label>VIN</label>
          <input
            type="text"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder={readingVin ? "Reading from vehicle…" : "Enter manually if needed"}
            spellCheck={false}
            maxLength={17}
          />
        </div>
        <button
          onClick={() => void runVinRead()}
          disabled={readingVin || connection.getState().kind !== "ready"}
        >
          {readingVin ? "Reading…" : "Re-read VIN"}
        </button>
        {settings.autoDecodeVin && vin && decode.kind === "idle" && (
          <button onClick={() => void runDecode(vin)}>Decode</button>
        )}
      </div>

      {decode.kind === "running" && (
        <div className="callout">
          Decoding your VIN via NHTSA's free public API…
          {!settings.nhtsaDisclosureSeen && (
            <div style={{ marginTop: 6 }}>
              This is the only network request this app makes outside loading itself.
              The VIN never leaves your device for any other reason.
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <button className="linklike" onClick={handleSkipDecode}>
              Skip this time
            </button>
            {" · "}
            <button className="linklike" onClick={() => void handleDisableDecode()}>
              Don't auto-decode in the future
            </button>
          </div>
        </div>
      )}
      {decode.kind === "ok" && (
        <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
          Decoded from your VIN via NHTSA. Edit any field as needed.
        </div>
      )}
      {decode.kind === "error" && (
        <div className="callout warn">
          NHTSA decode failed: {decode.message}. Fill in the fields manually.
        </div>
      )}
      {vinReadFailed && (
        <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
          VIN auto-read not supported by this vehicle; please enter manually if
          you'd like.
        </div>
      )}

      <div className="grid-2">
        <div className="field">
          <label>Year</label>
          <input
            type="text"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              syncSlugFromFields(e.target.value, make, model);
            }}
            inputMode="numeric"
          />
        </div>
        <div className="field">
          <label>Make</label>
          <input
            type="text"
            value={make}
            onChange={(e) => {
              setMake(e.target.value);
              syncSlugFromFields(year, e.target.value, model);
            }}
          />
        </div>
        <div className="field">
          <label>Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              syncSlugFromFields(year, make, e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label>Trim</label>
          <input type="text" value={trim} onChange={(e) => setTrim(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Display name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Folder slug</label>
        <input
          type="text"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value.toLowerCase());
            setSlugTouched(true);
          }}
          spellCheck={false}
        />
        <div className="help">
          Data lands in <code>data/{settings.owner}/{slug || "…"}/</code>
        </div>
      </div>

      <div className="field">
        <label>Profile</label>
        <select
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          className="select"
        >
          {profiles.map((p) => (
            <option key={p.profile_id} value={p.profile_id}>
              {p.display_name}
            </option>
          ))}
        </select>
        {isHybrid && profileId === "generic-obd2" && (
          <div className="help warn-inline">
            NHTSA flagged this vehicle as a hybrid. Consider the{" "}
            <code>generic-toyota-hybrid</code> or a Lexus profile to capture HV
            battery data.
          </div>
        )}
      </div>

      <div className="field">
        <label>Notes (optional)</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {err && <div className="callout err">{err}</div>}

      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={onCancel} disabled={busy}>Cancel</button>
        <div className="spacer" />
        <button className="primary" onClick={() => void handleSave()} disabled={busy}>
          {busy ? "Saving…" : "Save vehicle"}
        </button>
      </div>
    </div>
  );
}
