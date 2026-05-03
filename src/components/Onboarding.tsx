import { useState } from "react";
import { patchSettings } from "../lib/db";
import {
  ensureOwnerDir,
  ensurePermission,
  pickRootDirectory,
} from "../lib/fs";
import { normalizeOwner, ownerError, suggestDefaultOwner } from "../lib/owner";
import type { Settings } from "../types";

type Props = {
  initialSettings: Settings;
  initialRoot: FileSystemDirectoryHandle | null;
  permissionGranted: boolean;
  onComplete: (settings: Settings, root: FileSystemDirectoryHandle) => void;
};

type Step = "folder" | "owner";

export function Onboarding({
  initialSettings,
  initialRoot,
  permissionGranted,
  onComplete,
}: Props) {
  // If we have a stored handle but permission isn't currently granted, send
  // the user to step 1 — that's where the "Re-grant access" button lives, and
  // any subsequent disk operation will need permission first.
  const [step, setStep] = useState<Step>(
    initialRoot && permissionGranted ? "owner" : "folder",
  );
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(initialRoot);
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
      setRoot(handle);
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
    if (!root) return;
    setError(null);
    setBusy(true);
    try {
      const state = await ensurePermission(root);
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
    if (!root) return;
    const owner = normalizeOwner(ownerInput);
    const err = ownerError(owner);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // The click that triggered this handler is a fresh user activation, so
      // this is a safe place to (re-)request permission if it lapsed.
      const granted = await ensurePermission(root);
      if (granted !== "granted") {
        setError(
          "Folder permission was not granted. Click Back, then 'Re-grant access' on Step 1.",
        );
        return;
      }
      await ensureOwnerDir(root, owner);
      const next = await patchSettings({ owner, rootDirHandleSet: true });
      onComplete(next, root);
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
          {root ? (
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
        <div className="step">Step 2 of 2</div>
        <h1>What should we call you?</h1>
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
          <button onClick={() => setStep("folder")} disabled={busy}>
            Back
          </button>
          <div className="spacer" />
          <button className="primary" onClick={handleConfirmOwner} disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
