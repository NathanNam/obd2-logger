import { useCallback, useEffect, useState } from "react";
import { BrowserSupportGate } from "./components/BrowserSupportGate";
import { MainShell } from "./components/MainShell";
import { Onboarding } from "./components/Onboarding";
import { evaluateBrowser, type FeatureSupport } from "./lib/browser-support";
import { loadSettings, patchSettings } from "./lib/db";
import {
  ensurePermission,
  forgetRoot,
  loadStoredRoot,
  scaffoldRootChildren,
} from "./lib/fs";
import { syncProfilesToDisk } from "./profiles/disk";
import { DEFAULT_SETTINGS, type Settings } from "./types";

type AppState =
  | { kind: "loading" }
  | { kind: "unsupported"; support: FeatureSupport }
  | {
      kind: "onboarding";
      settings: Settings;
      root: FileSystemDirectoryHandle | null;
      permissionGranted: boolean;
    }
  | { kind: "ready"; settings: Settings; root: FileSystemDirectoryHandle };

export default function App() {
  const [state, setState] = useState<AppState>({ kind: "loading" });

  const bootstrap = useCallback(async () => {
    const verdict = evaluateBrowser();
    if (!verdict.ok) {
      setState({ kind: "unsupported", support: verdict.support });
      return;
    }

    const settings = await loadSettings();
    const stored = await loadStoredRoot();

    if (!stored) {
      setState({
        kind: "onboarding",
        settings,
        root: null,
        permissionGranted: false,
      });
      return;
    }

    if (stored.permission !== "granted") {
      setState({
        kind: "onboarding",
        settings,
        root: stored.handle,
        permissionGranted: false,
      });
      return;
    }

    if (!settings.owner) {
      setState({
        kind: "onboarding",
        settings,
        root: stored.handle,
        permissionGranted: true,
      });
      return;
    }

    await scaffoldRootChildren(stored.handle);
    await syncProfilesToDisk(stored.handle);
    setState({ kind: "ready", settings, root: stored.handle });
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const handleResetData = useCallback(async () => {
    if (!confirm("Forget the folder and reset settings? Files on disk are untouched.")) {
      return;
    }
    await forgetRoot();
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
          initialRoot={state.root}
          permissionGranted={state.permissionGranted}
          onComplete={async (settings, root) => {
            const granted = await ensurePermission(root);
            if (granted !== "granted") return;
            await scaffoldRootChildren(root);
            await syncProfilesToDisk(root);
            setState({ kind: "ready", settings, root });
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <MainShell
        settings={state.settings}
        rootDir={state.root}
        rootName={state.root.name}
        onResetData={handleResetData}
        onSettingsChange={(next) =>
          setState({ kind: "ready", settings: next, root: state.root })
        }
      />
    </div>
  );
}
