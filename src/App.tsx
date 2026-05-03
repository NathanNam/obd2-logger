import { useCallback, useEffect, useState } from "react";
import { BrowserSupportGate } from "./components/BrowserSupportGate";
import { MainShell } from "./components/MainShell";
import { Onboarding } from "./components/Onboarding";
import { evaluateBrowser, type FeatureSupport } from "./lib/browser-support";
import { loadSettings, patchSettings } from "./lib/db";
import { ensurePermission, forgetRoot, loadStoredRoot } from "./lib/fs";
import { isNative } from "./lib/platform";
import {
  nativeStorage,
  shouldAutoInitStorage,
  type Storage,
  storageFromHandle,
} from "./lib/storage";
import { syncProfilesToDisk } from "./profiles/disk";
import { DEFAULT_SETTINGS, type Settings } from "./types";

type AppState =
  | { kind: "loading" }
  | { kind: "unsupported"; support: FeatureSupport }
  | {
      kind: "onboarding";
      settings: Settings;
      storage: Storage | null;
      permissionGranted: boolean;
    }
  | { kind: "ready"; settings: Settings; storage: Storage };

export default function App() {
  const [state, setState] = useState<AppState>({ kind: "loading" });

  const bootstrap = useCallback(async () => {
    const verdict = evaluateBrowser();
    if (!verdict.ok) {
      setState({ kind: "unsupported", support: verdict.support });
      return;
    }

    const settings = await loadSettings();

    // Native shells (Capacitor): no folder picker. Storage is always the
    // app's Documents directory; we just need an owner to be set.
    if (shouldAutoInitStorage()) {
      const storage = nativeStorage();
      await scaffoldRootChildren(storage);
      await syncProfilesToDisk(storage);
      if (!settings.owner) {
        setState({
          kind: "onboarding",
          settings,
          storage,
          permissionGranted: true,
        });
        return;
      }
      setState({ kind: "ready", settings, storage });
      return;
    }

    // Web: walk through the folder-picker / permission flow.
    const stored = await loadStoredRoot();

    if (!stored) {
      setState({
        kind: "onboarding",
        settings,
        storage: null,
        permissionGranted: false,
      });
      return;
    }

    const storage = storageFromHandle(stored.handle);

    if (stored.permission !== "granted") {
      setState({
        kind: "onboarding",
        settings,
        storage,
        permissionGranted: false,
      });
      return;
    }

    if (!settings.owner) {
      setState({
        kind: "onboarding",
        settings,
        storage,
        permissionGranted: true,
      });
      return;
    }

    await scaffoldRootChildren(storage);
    await syncProfilesToDisk(storage);
    setState({ kind: "ready", settings, storage });
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const handleResetData = useCallback(async () => {
    if (!confirm("Forget the folder and reset settings? Files on disk are untouched.")) {
      return;
    }
    if (!isNative()) {
      await forgetRoot();
    }
    await patchSettings({ ...DEFAULT_SETTINGS });
    setState({ kind: "loading" });
    void bootstrap();
  }, [bootstrap]);

  if (state.kind === "loading") {
    return (
      <div className="center-stage">
        <div className="card">
          <p style={{ margin: 0, color: "var(--fg-dim)" }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (state.kind === "unsupported") {
    return (
      <div className="app">
        <BrowserSupportGate support={state.support} />
      </div>
    );
  }

  if (state.kind === "onboarding") {
    return (
      <div className="app">
        <Onboarding
          initialSettings={state.settings}
          initialStorage={state.storage}
          permissionGranted={state.permissionGranted}
          onComplete={async (settings, storage) => {
            if (!isNative()) {
              const handle = storage._legacyWebRoot();
              const granted = await ensurePermission(handle);
              if (granted !== "granted") return;
            }
            await scaffoldRootChildren(storage);
            await syncProfilesToDisk(storage);
            setState({ kind: "ready", settings, storage });
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <MainShell
        settings={state.settings}
        storage={state.storage}
        onResetData={handleResetData}
        onSettingsChange={(next) =>
          setState({ kind: "ready", settings: next, storage: state.storage })
        }
      />
    </div>
  );
}

async function scaffoldRootChildren(storage: Storage): Promise<void> {
  await storage.ensureDir("data");
  await storage.ensureDir("profiles");
}
