# Changelog

## 2026-05-04 — iOS / Web parity milestone

The iOS port now captures the same data as the web app on the same vehicle and adapter. Verified against a 2020 Lexus RX 450hL with back-to-back ~5-minute drives on the same Veepeak OBDCheck BLE+ — both apps logged ~40 PIDs at ~99% per-tick coverage.

### Cross-app fixes (web + iOS)

- **All-0xFF sentinel filter.** SAE J1979 ECUs report "supported but no data right now" via all-0xFF payloads. Both apps now treat that as a missed sample instead of decoding a literal 65535 km / 255. Fixes ghost values in `distance_since_clear`, `time_since_clear`, `warmups_since_clear`.
- **Strike rehab.** Every 30 ticks, both samplers un-demote silent PIDs so they get a fresh chance. Critical for hybrids: ICE-only PIDs go silent in EV mode and would otherwise stay demoted for the whole drive, missing the 2–3 minutes the engine actually runs.
- **Query dedupe.** When several PidDefs share a (mode, pid) — e.g. `battery_temp_1..4` all read different bytes from PID 95 — issue the query once per tick and apply each formula to the same payload. Faster *and* avoids rate-limiting on rapid-fire identical queries.
- **`Re-probe` button on the web app.** Mirrors the iOS `Manage vehicles → Re-probe` action. Clears `supportedStandardPids` and `supportedProfilePids` on a vehicle so the next session re-runs discovery + probe.

### iOS-only fixes

- **Multi-frame ISO-TP parsing.** The iOS Sampler was dropping every multi-frame Mode 21 response because `HexParsing.bytes` rejected any string containing the `<digit>:` frame-index character. Result: `hv_voltage` (PID 98), `battery_temp_1..4` (PID 95), and any other PID with a payload bigger than 6 bytes were stuck at 0% coverage. New `extractPayload` mirrors the web app's `decodePidResponse` — splits on whitespace, strips frame indices, scans each line for the response prefix.
- **`FormulaEvaluator` honors missing bytes.** The evaluator now passes JavaScript `undefined` (not 0) for byte indices the response didn't supply, so any formula that needs a missing byte returns nil instead of producing nonsense. Fixes MG torque columns showing `-4096` Nm and `+2208` Nm — both far outside the drivetrain's physical range.
- **20 ms inter-query gap + ELM `STOPPED` handling.** Veepeak's ELM327 firmware emits `STOPPED` if the next command arrives before the previous response's prompt has fully settled. The Sampler now sleeps 20 ms after every `elm.send` (success or failure) and explicitly recognises `STOPPED` as a strike. Per-PID coverage rose from ~50–70% to ~99%.
- **Per-ECU ATSH addressing.** `Sampler` and `ProfileProbe` group PIDs by ECU and send `ATSH<request_header>` per group. Previously Mode 21 PIDs went to the broadcast functional address and either silently returned `NO_DATA` or were falsely marked supported via leaked cross-ECU responses.
- **Location-based background keep-alive.** Replaced silent-audio keep-alive (which glitched YouTube and was App-Store risky) with the `location` background mode — Apple's sanctioned trip-tracking pattern, used by Strava / Waze. No GPS data is logged.
- **Standard PID coverage.** `LoggingSession` now calls `StandardPIDDiscovery.discover` once per vehicle and merges the result with the profile's PIDs, so the iOS CSV columns include ~30 standard SAE J1979 Mode 01 PIDs alongside any profile-specific ones.
- **NHTSA VIN auto-decode** in `Add vehicle` — Swift port of `src/lib/nhtsa.ts`. Reads VIN from the ECU (with a `0100` warmup, retry, and permissive multi-frame parser), decodes via the free vPIC API, prefills Year/Make/Model/Trim/Profile.
- **ECU liveness pre-check.** Sends one `0100` query before the full discovery + probe. If silent, aborts in ~4 s with a clear "is the car in READY mode?" error instead of burning ~15 s of timeouts producing 0-row sessions.

### Documentation

- `examples/README.md` documents every column in the example CSV (display name, unit, PID, ECU, decode formula) grouped by category.
- `examples/` ships a real 10-row session capture, plus iOS and web app screenshots referenced from the main README.
- `ios-native/README.md` reflects the parity milestone and the location-based background-mode change.
