export type FeatureSupport = {
  webBluetooth: boolean;
  fileSystemAccess: boolean;
};

export type BrowserVerdict =
  | { ok: true; support: FeatureSupport }
  | { ok: false; support: FeatureSupport; reason: string };

export function detectFeatures(): FeatureSupport {
  const webBluetooth =
    typeof navigator !== "undefined" &&
    typeof navigator.bluetooth !== "undefined" &&
    typeof navigator.bluetooth.requestDevice === "function";

  const fileSystemAccess =
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function";

  return { webBluetooth, fileSystemAccess };
}

export function evaluateBrowser(): BrowserVerdict {
  const support = detectFeatures();
  if (support.webBluetooth && support.fileSystemAccess) {
    return { ok: true, support };
  }
  const missing: string[] = [];
  if (!support.webBluetooth) missing.push("Web Bluetooth");
  if (!support.fileSystemAccess) missing.push("File System Access");
  return {
    ok: false,
    support,
    reason: `Missing: ${missing.join(" and ")}.`,
  };
}
