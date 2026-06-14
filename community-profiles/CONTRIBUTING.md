# Contributing a community profile

A profile JSON tells OBD2 Logger which manufacturer-specific PIDs (beyond the standard SAE J1979 set) to query, how to decode each response, and what to label them in the UI.

This document is the workflow for authoring one for a vehicle that isn't yet covered.

## What you need

- The vehicle in question
- A BLE OBD2 adapter (Veepeak BLE+, Vgate iCar Pro BLE, vLinker MC+, or similar — any ELM327-compatible BLE adapter works)
- An iPhone with the app installed (or the web app on a Chrome/Edge laptop)
- A computer for running the analysis tooling
- Several hours of garage time across multiple drives

## Step 1 — Start from `_template.json`

Copy [`_template.json`](./_template.json) to a new file named after your vehicle (e.g. `honda-civic-hybrid-2024.json`). Fill in:

- `profile_id` — kebab-case, must match the filename minus `.json`
- `profile_version` — start at `0.1.0-partial` and bump as you add validation
- `display_name` — what shows in the picker (e.g. *"Honda Civic Hybrid (2024+) — PARTIAL"*)
- `vehicle_match.make` / `models` / `year_min` / `year_max` — used to suggest the profile when adding a vehicle
- `ecus` — usually `engine` (request `7E0`, response `7E8`) and a hybrid controller (varies by manufacturer)

## Step 2 — Run a sweep against the vehicle

The web app has a **PID Sweep** button (under the Sweep section) that walks every PID in the configured ranges and dumps responses to a `sweep__*.json` file.

Settings:
- ECUs: include the engine + any other controllers your manufacturer documents
- Modes: start with `21` (most manufacturer-specific custom data) and `22` (UDS ReadDataByIdentifier — modern manufacturers)

Run the sweep with the engine warm and the vehicle in `Park` for safety.

The output file will list every responding PID, the raw bytes returned, and any rejection codes for non-supported PIDs.

## Step 3 — Identify what each PID returns

This is the empirical research step. The responding PIDs from Step 2 are *unknown* — you need to figure out what each represents.

The repo's [`scripts/identify-mg-bytes.py`](../scripts/identify-mg-bytes.py) tool helps:

```bash
python3 scripts/identify-mg-bytes.py path/to/raw__SESSION.csv
```

It byte-slices each multi-byte response and correlates against known signals (RPM, speed, throttle, engine load) to suggest which bytes carry which signal. Use it across **multiple raw-hex captures at different driving states** (idle, cruise, acceleration) to triangulate.

The flow Nathan used for the Lexus profile (documented in `validated_against` notes):
1. Capture raw hex during a varied-state drive
2. Bucket by speed (or throttle, RPM, etc.) and look for which bytes vary within-bucket vs across-bucket
3. Cross-reference with community PID lists for that manufacturer
4. Validate by held-state captures (constant 60 km/h, hard accel, regen) and looking at within-state variance

## Step 4 — Author each PID entry

Once you've identified what bytes mean, write the PID entry:

```json
{
  "id": "mg1_torque",
  "display_name": "MG1 torque",
  "ecu": "hybrid_controller",
  "mode": "21",
  "pid": "61",
  "unit": "Nm",
  "formula": "((D*256+E)-32768)/8",
  "category": "hybrid",
  "min": -400,
  "max": 400
}
```

Fields:
- `id` — snake_case identifier; becomes the CSV column name
- `formula` — JS-style expression; bytes A–J are bound to bytes 0–9 of the response payload (after the `4<mode><pid>` response code prefix is stripped)
- `category` — one of `engine`, `hybrid`, `battery`, `transmission`, `emissions`, `diagnostics`, `other`
- `min`, `max` — for sanity-check bounds; not enforced, just hints to readers

## Step 5 — Document what you validated

Add an entry to `validated_against`:

```json
{
  "vehicle": "2024 Honda Civic Hybrid (your name's)",
  "date": "2026-XX-XX",
  "notes": "Verified mg1_torque DE byte at idle (= 0x8000 ≈ 0 Nm) and under acceleration (DE varies in the +1500..+4000 Nm range). Sweep confirmed PIDs 61, 62 respond on hybrid_controller; PID 63 (mgr) returns NO_DATA — single MG configuration. Untested: regen behavior, sustained cruise."
}
```

Be specific about what's tested and what isn't. Future contributors and users rely on this to know how much to trust each PID.

## Step 6 — Validate the JSON

Run a basic syntax check:

```bash
python3 -m json.tool community-profiles/honda-civic-hybrid-2024.json > /dev/null && echo OK
```

If you have a Mac with Xcode + the iOS app, drop the JSON into your simulator's `Documents/profiles/` and verify the app loads it without errors (check the red banner at the top of the main shell).

## Step 7 — Submit a PR

```bash
git checkout -b community-profile/honda-civic-hybrid-2024
git add community-profiles/honda-civic-hybrid-2024.json community-profiles/README.md
git commit -m "Add Honda Civic Hybrid 2024+ community profile"
git push origin community-profile/honda-civic-hybrid-2024
```

Open a PR on GitHub. Update `community-profiles/README.md`'s table to include your profile.

The maintainers will review the JSON for syntactic correctness and obvious red flags (Mode 22 writes that could be unsafe, formulas that look wrong) but **cannot validate against your vehicle**. The `validated_against` notes are where you take responsibility for the accuracy of what you've documented.

## What gets rejected

- **Mode 22 writes** that could change vehicle behavior (anything beyond ReadDataByIdentifier)
- **Profiles for vehicles the contributor doesn't own** (hand-copied from forums without first-hand verification)
- **Profiles with no `validated_against` entries** (we need to know what you actually tested)
- **Profiles that require a paid VPN, custom firmware, or other gatekept access** — must work with off-the-shelf BLE OBD2 adapters

## Starting points for popular vehicles

Some vehicle communities have done significant PID research:

- **Toyota / Lexus hybrids**: [PriusChat custom PIDs](https://priuschat.com/forums/gen-3-prius-technical-discussion.85/) — extensive Mode 21 documentation
- **Ford EcoBoost**: [FORScan forums](https://forscan.org/forum/) — Mode 22 PIDs widely shared
- **VW / Audi**: Ross-Tech's VCDS database has signal definitions; some applicable to OBD2 Mode 22
- **BMW**: ISTA-D and ENET protocol research; less BLE-friendly
- **Tesla**: limited; Tesla doesn't expose useful OBD2 in most models

These are starting points for the *PID list*. You still need to validate each one against your specific vehicle.

## Working with Mode 22 (UDS) vehicles

Older manufacturer-specific data lives in **Mode 21** (single-byte PIDs, `21 XX`) — Toyota / Lexus use this heavily. Newer manufacturers (Hyundai-Kia 2018+, VW/Audi, modern Ford, etc.) have moved everything to **Mode 22** (UDS ReadDataByIdentifier with 2-byte DIDs, `22 XX XX`). The differences matter:

### 1. Mode 22 DIDs are 2 bytes, not 1

A Mode 21 sweep walks 256 values (`21 00` through `21 FF`). A Mode 22 sweep walks up to 65,536 (`22 0000` through `22 FFFF`). Sweeping the full 16-bit space is impractical (~5+ hours). The default sweep config walks `0x0100 – 0x01FF` because that's where Hyundai-Kia EVs historically put live BMS data — but **every manufacturer puts their live data in a different range**.

If the default range returns all-NRC-31 (`requestOutOfRange`) responses on every PID, the ECU is alive and speaks Mode 22 but doesn't have any DIDs in that range. Probe other ranges in this rough order:

- `0xF180 – 0xF1FF` — ISO 14229 standard identification DIDs (VIN at F190, software part numbers, ECU manufacturing dates). **Always start here** — if `F190` returns positive data, you've proven Mode 22 works on this ECU and can hunt for the proprietary live-data range.
- `0x0100 – 0x01FF` — Hyundai-Kia BMS live data (EVs, HEVs).
- `0xB000 – 0xB0FF`, `0x4000 – 0x40FF`, `0xC000 – 0xC0FF` — various manufacturer proprietary ranges; try them all.
- `0x0000 – 0x00FF`, `0x0200 – 0x02FF`, `0x0500 – 0x05FF` — lower-likelihood but cheap to try.

### 2. Extended diagnostic session may be required

Modern UDS ECUs gate most live-data DIDs behind the **extended diagnostic session** (UDS service `10 03`). In the default session (`10 01`, the state at adapter power-on), only ISO-mandated identification DIDs (`F1xx`) are reachable. Without entering extended session, every Mode 22 query for live data returns NRC 31 — even though the ECU is right there responding.

The sweep tool and the sampler both send `10 03` automatically before iterating Mode 22 PIDs on each ECU. If you ever see this pattern:

- `F180 – F1FF` returns OK responses (identification works).
- Every other range returns NRC 31 across every DID.

…you're being session-gated. If our `1003` injection ever fails for an exotic ECU, you may need to extend the timing or add a periodic `3E 00` (TesterPresent) keep-alive.

### 3. Long responses are multi-frame ISO-TP

UDS DIDs frequently return payloads of 30–120+ bytes (think a full BMS state block: SOC + cell voltages × 64 cells + cell temps + currents + flags). These don't fit in one 8-byte CAN frame, so they're transmitted as a sequence of ELM327 lines:

```
03E                  ← length header: 0x3E = 62 bytes total payload
0:6201018FF7FF       ← first frame: positive prefix + first 3 data bytes
1:EF6A0000000000     ← continuation frame 1
2:002009371C1B1B    ← continuation frame 2
...
8:EA0000000003E8    ← last frame, padded with AA if short
```

The web Sampler / sweep tool and the iOS Sampler both reassemble these into a single payload, strip the `62 0X XX` response prefix, and trim trailing `AA` padding. If you're parsing raw responses yourself, you need to do the same.

### 4. Recommended workflow for Mode 22 vehicles

1. **Probe `F180 – F1FF` first.** If positive responses appear on engine (7E0) and any other candidate ECUs, Mode 22 is supported and you know which addresses to focus on. If everything returns NRC 31 here too, the ECU may be locked behind a manufacturer-specific authenticated session (uncommon but documented for some EVs).
2. **Walk other DID ranges until you find live data.** Score each range by how many DIDs return non-empty payloads (not just NRC 31).
3. **Sweep the same range twice** at different vehicle states (engine off vs running, or before/after a hard accel). DIDs whose response *bytes change between sweeps* are live signals; DIDs whose bytes are identical are static configuration.
4. **Capture a varied-state raw-mode session** with the live DIDs declared in the profile (single-byte placeholder formula `A` is fine for raw capture). Drive 5–10 minutes covering idle / cruise / accel / regen / EV-only (for hybrids).
5. **Run `scripts/identify-mg-bytes.py`** against the CSV — it splits each multi-byte response column into per-byte and adjacent-byte-pair candidates and correlates each against throttle / engine load / RPM / speed. Strong correlations identify which bytes carry which signal.
6. **Author proper PID entries** for the identified bytes, replacing the raw placeholders. Document everything in the profile's `validated_against` entry.
