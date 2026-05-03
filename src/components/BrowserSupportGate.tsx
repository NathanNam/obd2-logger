import { Fragment } from "react";
import type { FeatureSupport } from "../lib/browser-support";

type Props = {
  support: FeatureSupport;
};

export function BrowserSupportGate({ support }: Props) {
  const missing: string[] = [];
  if (!support.webBluetooth) missing.push("Web Bluetooth");
  if (!support.fileSystemAccess) missing.push("File System Access");

  return (
    <div className="center-stage">
      <div className="card">
        <div className="step">Unsupported browser</div>
        <h1>This browser is missing required APIs</h1>
        <p>
          OBD2 Logger needs{" "}
          {missing.map((name, i) => (
            <Fragment key={name}>
              {i > 0 && " and "}
              <strong>{name}</strong>
            </Fragment>
          ))}
          , which today only ship in Chrome and Edge on desktop (Windows,
          macOS, or Linux).
        </p>
        <div className="callout warn">
          Firefox, Safari, and any browser on iOS are not supported in v1. Android
          Chrome works for Bluetooth but not for direct disk writes.
        </div>
        <p>
          Open this page in one of:
        </p>
        <ul>
          <li>
            <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
              Google Chrome (desktop)
            </a>
          </li>
          <li>
            <a href="https://www.microsoft.com/edge" target="_blank" rel="noreferrer">
              Microsoft Edge (desktop)
            </a>
          </li>
        </ul>
        <p className="mono" style={{ fontSize: 12, color: "var(--fg-faint)" }}>
          Detected: webBluetooth={String(support.webBluetooth)} · fileSystemAccess=
          {String(support.fileSystemAccess)}
        </p>
      </div>
    </div>
  );
}
