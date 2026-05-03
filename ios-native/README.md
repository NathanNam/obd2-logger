# OBD2 Logger — iOS native

Native Swift / SwiftUI iOS app, targeting iOS 17+. Sibling of the web app at the repo root, sharing only the JSON profile files (bundled into both via `src/profiles/builtin/`).

## Why a separate native app

The web build can't run continuously in the background on iOS — WKWebView's JavaScript runtime is suspended by iOS within seconds of backgrounding, which kills the OBD2 sampler timer. Declaring `bluetooth-central` keeps native Core Bluetooth callbacks alive but not JS. A native sampler in Swift is the proper fix.

## Build & run

Prereqs: Xcode 15+ on macOS, [`xcodegen`](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

The `OBD2Logger.xcodeproj` is generated from `project.yml`. To regenerate after changing `project.yml`:

```bash
cd ios-native
xcodegen generate
```

To open and run:

```bash
open OBD2Logger.xcodeproj
# in Xcode: pick a device (iPhone simulator or your physical iPhone), ⌘R
```

The project signs against Apple Developer team `794FX757KP` automatically. Bundle ID is `com.nathannam.obd2logger` (matches the App Store Connect record).

## Build phases

Tracked by PR sequence. Each PR is independently runnable on-device.

- ✅ **Phase 1** — Xcode scaffold, signing, "Hello, OBD2 Logger" SwiftUI shell
- ⏳ **Phase 2** — `CoreBluetooth` actor + ELM327 line-buffered command queue
- ⏳ **Phase 3** — JSON profile loader + JavaScriptCore-based formula evaluator
- ⏳ **Phase 4** — Mode 09 VIN read + Mode 01 supported-PID discovery + profile probe
- ⏳ **Phase 5** — Tick-driven sampler + CSV writer to `Documents/`
- ⏳ **Phase 6** — SwiftUI screens (Onboarding, Vehicle, Connection, Logging, Sessions)
- ⏳ **Phase 7** — Background BLE (`bluetooth-central` + native sampler keeps logging while Maps is in foreground — the actual goal)
- ⏳ **Phase 8** — TestFlight distribution

## Layout

```
ios-native/
├── project.yml                 # xcodegen spec — source of truth for project structure
├── OBD2Logger.xcodeproj/       # generated; commit, but don't hand-edit
└── OBD2Logger/
    ├── OBD2LoggerApp.swift     # app entry
    ├── ContentView.swift       # root view
    ├── Info.plist
    ├── Assets.xcassets/
    └── Preview Content/
```

Source files live under `OBD2Logger/`. New Swift files added there are picked up automatically on the next `xcodegen generate` (no manual project edits needed).
