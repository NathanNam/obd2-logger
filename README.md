# OBD2 Logger

A browser-based data logger for the OBD2 port. Connect a Bluetooth (BLE) OBD2 adapter, pick a folder on your machine, and stream comprehensive vehicle telemetry — including manufacturer-specific data on profiled vehicles — straight to per-vehicle CSV files. No backend, no cloud, no accounts.

**Try it live:** <https://obd2-logger-production.up.railway.app/> — open in Chrome or Edge desktop. All data still lives only on your machine; the hosted version just delivers the static bundle.

## What it does

- **Connects to a BLE OBD2 adapter from Chrome/Edge** via Web Bluetooth.
- **Auto-discovers** every standard mode-01 PID the vehicle reports as supported.
- **Streams vehicle profiles** (`generic-obd2`, `generic-toyota-hybrid`, `lexus-rx450hl-2020`) so vehicles with curated PID definitions also log HV battery state, motor-generator telemetry, inverter temperatures, fuel trims, and more.
- **Writes one CSV per session** under a per-owner / per-vehicle folder you pick. Each row is one tick (default 1 Hz) with aligned values for every signal.
- **Decodes your VIN** via the free NHTSA vPIC API to pre-fill year / make / model / trim. Single network call per vehicle, easy to skip.
- **No backend.** Vehicle metadata, session CSVs, and profiles all live on your machine.

## Browser support

| Browser | Status |
|---|---|
| Chrome desktop (Win / macOS / Linux) | **Primary target** |
| Edge desktop (Win / macOS) | **Primary target** |
| Chrome Android | Best-effort (Bluetooth works, file writes do not) |
| Firefox / Safari / any iOS browser | Not supported |

Web Bluetooth and the File System Access API are both required.

## Run it locally (5-minute setup)

You need [Node.js LTS](https://nodejs.org) and [git](https://git-scm.com) installed.

```bash
git clone https://github.com/NathanNam/obd2-logger.git
cd obd2-logger
npm install
npm run dev
```

Open <http://localhost:5173> in **Chrome or Edge desktop**. `localhost` is exempt from the HTTPS requirement that Web Bluetooth normally imposes, so no certificate setup is needed.

For a more production-like local run:

```bash
npm run build
npm run preview
```

## Native iOS app

A separate native Swift / SwiftUI app targeting iOS 17+ lives in [`ios-native/`](./ios-native). It uses the same JSON profiles bundled into this repo as the web app, but reimplements the OBD2 stack on top of `CoreBluetooth` so it can keep logging in the background while the user has Google Maps (or any other app) in the foreground — something the web/WebView path can't do because iOS suspends WebKit JavaScript when backgrounded. See `ios-native/README.md` for build instructions.

A previous Capacitor experiment in `ios/` was removed in favor of going pure-native; the WKWebView's JS pause on backgrounding made continuous BLE logging impossible without hacks.

## First-run flow

1. **Pick a folder.** The app calls `showDirectoryPicker()` and creates `data/` and `profiles/` inside whatever you choose. Documents, a synced Drive folder, a dedicated `obd2/` folder — your call.
2. **Set an owner name.** Lowercase kebab-case (`me`, `nathan`, `lisa`). Your data lives under `data/<owner>/`. This is what makes friend-shared data drop in cleanly without slug collisions.
3. **Connect your adapter.** Plug the OBD2 dongle in, key the car to ON (engine off is fine for the init handshake), click **Connect adapter…**, pick your device from the browser's Bluetooth picker. The app runs the ELM327 init sequence (`ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATSP0 → ATCAF1`).
4. **Add a vehicle.** With the adapter ready, click **Manage vehicles → Add vehicle…**. The app reads the VIN from the ECU (mode-09 PID 02) and decodes it via NHTSA. Edit any pre-filled field, pick a profile, save.
5. **Start logging.** Hit **Start logging**. The app probes profile-defined PIDs against the live ECU, builds the active registry, opens a CSV in `data/<owner>/<slug>/sessions/`, and writes one row per tick.

## Folder layout

```
<your-chosen-root>/
├── data/
│   ├── nathan/                      ← this app instance's owner
│   │   ├── 2020-lexus-rx450hl/
│   │   │   ├── vehicle.json
│   │   │   ├── sessions.jsonl
│   │   │   └── sessions/
│   │   │       └── 2026-05-02T17-23-09Z__a3f9k2lp.csv
│   │   └── 2018-honda-civic/...
│   └── lisa/                        ← friend's data, dropped in by you
│       └── 2022-rav4-hybrid/...
└── profiles/
    ├── generic-obd2.json
    ├── generic-toyota-hybrid.json
    └── lexus-rx450hl-2020.json
```

The owner level is what makes friend-sharing work. Hand a friend `data/nathan/` as a zip; they drop it into their `data/`. No renaming, no path collisions.

## CSV format

Wide table, one column per active PID. ISO-8601 UTC timestamps with millisecond precision. Blank cells mean "no data captured for this PID in this tick" — there is no forward-fill, so what you see is what was actually captured.

```
timestamp_utc,session_elapsed_ms,rpm,speed,coolant_temp,...
2026-05-02T17:23:09.412Z,0,820,0,84,...
2026-05-02T17:23:10.412Z,1000,825,0,84,...
```

Open in Excel, pandas (`pd.read_csv(...)`), DuckDB, or any other tool — no preprocessing required.

## Profiles

Profiles are JSON documents that describe a vehicle family's PID landscape. Three ship with the app:

- **`generic-obd2`** — universal fallback, auto-discovered standard PIDs only.
- **`generic-toyota-hybrid`** — best-effort coverage for Toyota Hybrid Synergy Drive vehicles. Adds HV SOC, voltage, current, temperature, and MG RPM.
- **`lexus-rx450hl-2020`** — partial profile (v0.6.0-partial). Validated against a real 2020 RX450hL via empirical PID sweeps and held-state raw-hex capture diffs. Currently exposes MG1 / MG2 / MGR torques (PIDs 61/62/63), HV pack voltage (PID 98), and four cell-block temperatures (PID 95). Remaining unidentified live PIDs are catalogued in `validated_against` for future identification work — see `scripts/identify-mg-bytes.py` for the tooling used to build it out.

You can import any third-party profile JSON via **Settings → Profiles**, and export any installed profile back to JSON to share. Authoring new profiles is a manual JSON-edit task (no in-app editor in v1) — the schema is documented in `src/profiles/types.ts`.

### Got a different car?

Community-contributed profiles for other vehicles (Honda hybrids, Ford EcoBoost, BMW, Tesla, etc.) live in [`community-profiles/`](./community-profiles). Browse the list there, download a `.json`, and import it into the app. To contribute a profile for your own vehicle, see [`community-profiles/CONTRIBUTING.md`](./community-profiles/CONTRIBUTING.md) — the workflow involves a PID sweep, byte-slice analysis with `scripts/identify-mg-bytes.py`, and a `validated_against` block documenting what you actually tested.

## Sharing your data

**Settings → Export your data** zips up `data/<owner>/` (or a single vehicle) into a single download. Send the zip to a friend; they unzip it directly into their `data/` and your owner directory appears next to theirs. The app ignores other owners' folders — it only ever writes to its own.

There is no in-app "import a friend's zip" flow in v1. Manual placement keeps the strict ownership boundary clean.

## Privacy

- All telemetry stays on your machine.
- The only outbound network requests are (a) loading the app's own static assets and (b) one NHTSA VIN decode per vehicle on first connect.
- The NHTSA call can be skipped per-vehicle (link in the form) or disabled globally (**Settings → VIN auto-decode**).
- The VIN is stored in `vehicle.json` and IndexedDB. It never appears in CSV content or filenames.

## Deploy to Railway

The repo includes a `Dockerfile` and `railway.toml` that build the static bundle and serve it from a tiny Node container. To deploy:

1. Create a new Railway project from this repo.
2. Railway detects the `Dockerfile` and builds with no extra config.
3. Open the generated `*.up.railway.app` URL in Chrome / Edge.

Railway never sees any of your vehicle data — the URL just delivers the static bundle to whoever opens it. Each visitor's data lives only in their own browser + their own picked folder. The same setup works on Vercel / Netlify / Cloudflare Pages with their respective auto-detection.

Web Bluetooth requires HTTPS in production; Railway provisions HTTPS automatically for the generated domain.

## Architecture (one-line tour)

- `src/lib/` — IndexedDB wrapper, File System Access helpers, NHTSA client, CSV writer, sessions.jsonl, JSZip data export.
- `src/obd/` — BLE transport (with adapter UUID registry), ELM327 client (line/prompt framing + command queue), VIN reader, supported-PID discovery, profile-PID probe, sandboxed formula evaluator, tick-based sampler, logging-session orchestrator.
- `src/profiles/` — profile types, validator, registry, three built-in JSON profiles.
- `src/components/` — React UI: browser-support gate, onboarding, vehicle form / manager, settings, connection panel, logging controls, live readout, sessions list, sparkline.
- `scripts/` — analysis tooling that runs against captured CSVs (e.g. `identify-mg-bytes.py`, which byte-slices multi-byte PID responses and correlates each slice against state signals to identify which bytes carry torque / RPM / etc.).

## Out of scope (v1)

- DTC read / clear, freeze frame, bidirectional control commands.
- iOS support (Web Bluetooth is unavailable on iOS Safari and on iOS Chrome / Edge, since iOS browsers all use WebKit).
- Bluetooth Classic / SPP adapters (most cheap ELM327 dongles).
- Cloud sync, accounts, multi-device sync.
- In-app profile editor — profiles are JSON, edit in your text editor of choice.
- Live charts beyond a basic per-PID sparkline.

See the PRD for the full out-of-scope list and v2 ideas.
