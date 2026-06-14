# Community profiles

User-contributed vehicle profiles for OBD2 Logger. The three profiles bundled with the app (`generic-obd2`, `generic-toyota-hybrid`, `lexus-rx450hl-2020`) cover a small slice of the OBD2 universe — anything beyond that lives here.

## Installing a profile

Tap the link to a `.json` profile file below, then on iOS:

1. Open the link on your iPhone (Safari, Mail, Messages — anywhere).
2. Tap the **Share** icon → **Open in OBD2 Logger**.
3. The profile installs to your app's `Documents/profiles/` and appears in the Profile picker the next time you Add a vehicle (or change a vehicle's profile).

You can also manually drop a `.json` file into **Files app → On My iPhone → OBD2 Logger → profiles/** — the app picks it up on next launch.

## Available profiles

| Profile | Vehicle match | Contributor | Last validated | File |
|---|---|---|---|---|
| `toyota-rav4-hybrid-2019plus` | Toyota RAV4 Hybrid / Prime (2019+) | @NathanNam | unvalidated — inherited from `lexus-rx450hl-2020` (same TNGA-K + THS-II platform) | [json](./toyota-rav4-hybrid-2019plus.json) |
| `toyota-rav4-2019plus` | Toyota RAV4 gas (2019+) | @NathanNam | scaffold only — relies on standard Mode 01 auto-discovery | [json](./toyota-rav4-2019plus.json) |
| `toyota-camry-hybrid-2018plus` | Toyota Camry Hybrid (2018+) | @NathanNam | unvalidated — inherited from `lexus-rx450hl-2020` (same TNGA-K + THS-II platform, FWD-only) | [json](./toyota-camry-hybrid-2018plus.json) |
| `toyota-camry-2018plus` | Toyota Camry gas (2018-2024) | @NathanNam | scaffold only — relies on standard Mode 01 auto-discovery | [json](./toyota-camry-2018plus.json) |
| `nissan-rogue-2021plus` | Nissan Rogue gas (2021+) | @NathanNam | scaffold only — relies on standard Mode 01 auto-discovery | [json](./nissan-rogue-2021plus.json) |
| `kia-niro-hybrid-2023plus` | Kia Niro Hybrid (2023+) | @NathanNam | 2026-06-14: 39 standard Mode 01 PIDs confirmed against a 2026 Niro LX Hybrid. Mode 22 (BMS / HCU) sweep needed for hybrid telemetry. | [json](./kia-niro-hybrid-2023plus.json) |

## Profile authoring is hard

This is the honest truth — most of the work to make a useful profile is empirical research against a real vehicle, not the JSON authoring itself. To create a meaningful profile you generally need:

- The actual vehicle (in your driveway)
- A BLE OBD2 adapter
- Hours of running PID sweeps + diff analysis (similar to what Nathan did for the Lexus RX450hL profile shipped with the app)
- Knowledge of how to interpret responses (formulas, units, scaling factors)

If you don't have all of that, your best bet is to start from a community PID list (PriusChat, ClubLexus, FORScan forums, Torque Pro PID database) and validate against your vehicle. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow.

## Why "community" and not "official"?

The maintainers can't realistically test profiles against vehicles they don't own. Community profiles are best-effort — contributors are encouraged to document what they validated, what's still tentative, and what's known to not work. The `validated_against` field in each profile JSON is where this lives.

Profiles with broken decoding, wrong formulas, or unsafe Mode 22 calls (some manufacturers have proprietary writes that can change vehicle behavior) will be removed without notice. The bar is "doesn't actively make things worse" — being incomplete is fine, being wrong is not.
