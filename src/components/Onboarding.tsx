import { useState } from "react";
import { patchSettings } from "../lib/db";
import { ensurePermission, pickRootDirectory } from "../lib/fs";
import { normalizeOwner, ownerError, suggestDefaultOwner } from "../lib/owner";
import { isNative } from "../lib/platform";
import { storageFromHandle, type Storage } from "../lib/storage";
import type { Settings } from "../types";

type Props = {
  initialSettings: Settings;
  initialStorage: Storage | null;
  permissionGranted: boolean;
  onComplete: (settings: Settings, storage: Storage) => void;
};

type Step = "folder" | "owner";

export function Onboarding({
  initialSettings,
  initialStorage,
  permissionGranted,
  onComplete,
}: Props) {
  const native = isNative();

  // On native, there's no folder picker step — go straight to owner.
  // On web, follow the existing two-step flow.
  const [step, setStep] = useState<Step>(
    native || (initialStorage && permissionGranted) ? "owner" : "folder",
  );
  const [storage, setStorage] = useState<Storage | null>(initialStorage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ownerInput, setOwnerInput] = useState(
    initialSettings.owner || suggestDefaultOwner(),
  );

  async function handlePickFolder() {
    setError(null);
    setBusy(true);
    try {
      const handle = await pickRootDirectory();
      await patchSettings({ rootDirHandleSet: true });
      setStorage(storageFromHandle(handle));
      setStep("owner");
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (!aborted) {
        setError(e instanceof Error ? e.message : "Could not open the folder picker.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleReprompt() {
    if (!storage) return;
    setError(null);
    setBusy(true);
    try {
      const handle = storage._legacyWebRoot();
      const state = await ensurePermission(handle);
      if (state !== "granted") {
        setError("Permission was not granted. Click again to retry.");
        return;
      }
      setStep("owner");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request permission.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmOwner() {
    if (!storage) return;
    const owner = normalizeOwner(ownerInput);
    const err = ownerError(owner);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (!native) {
        // Web: re-request permission inside the user-activation gesture.
        const handle = storage._legacyWebRoot();
        const granted = await ensurePermission(handle);
        if (granted !== "granted") {
          setError(
            "Folder permission was not granted. Click Back, then 'Re-grant access' on Step 1.",
          );
          return;
        }
      }
      await storage.ensureDir(`data/${owner}`);
      const next = await patchSettings({ owner, rootDirHandleSet: true });
      onComplete(next, storage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the owner folder.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "folder") {
    return (
      <div className="center-stage">
        <div className="card">
          <div className="step">Step 1 of 2</div>
          <h1>Pick a folder for your data</h1>
          <p>
            OBD2 Logger writes CSVs, vehicle metadata, and profiles directly to a
            folder on your disk. Nothing leaves your machine.
          </p>
          <p>
            Pick somewhere stable — your Documents folder, a Google Drive folder
            (so it syncs), or a dedicated <code>obd2/</code> folder. The app will
            create <code>data/</code> and <code>profiles/</code> subdirectories
            inside it.
          </p>
          {error && <div className="callout err">{error}</div>}
          {storage ? (
            <div className="row">
              <button className="primary" onClick={handleReprompt} disabled={busy}>
                {busy ? "Requesting…" : "Re-grant access"}
              </button>
              <button onClick={handlePickFolder} disabled={busy}>
                Pick a different folder
              </button>
            </div>
          ) : (
            <button className="primary" onClick={handlePickFolder} disabled={busy}>
              {busy ? "Opening…" : "Choose folder…"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="center-stage">
      <div className="card">
        <div className="step">{native ? "Setup" : "Step 2 of 2"}</div>
        <h1>What should we call you?</h1>
        {native && (
          <p>
            Your data lives inside the OBD2 Logger app folder, accessible from the
            iOS Files app under <strong>On My iPhone → OBD2 Logger</strong>.
          </p>
        )}
        <p>
          Used to label your data folder so it's easy to share with friends later.
          Lowercase letters, digits, and dashes — like a folder name.
        </p>
        <div className="field">
          <label htmlFor="owner-input">Owner</label>
          <input
            id="owner-input"
            type="text"
            value={ownerInput}
            onChange={(e) => setOwnerInput(e.target.value)}
            onBlur={(e) => setOwnerInput(normalizeOwner(e.target.value))}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <div className="help">
            Your data will live in{" "}
            <code>
              data/{normalizeOwner(ownerInput) || "…"}/&lt;vehicle&gt;/
            </code>
          </div>
        </div>
        {error && <div className="callout err">{error}</div>}
        <div className="row">
          {!native && (
            <button onClick={() => setStep("folder")} disabled={busy}>
              Back
            </button>
          )}
          <div className="spacer" />
          <button className="primary" onClick={handleConfirmOwner} disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
