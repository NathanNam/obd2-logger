# Community profiles

User-contributed vehicle profiles for OBD2 Logger. The three profiles bundled with the app (`generic-obd2`, `generic-toyota-hybrid`, `lexus-rx450hl-2020`) cover a small slice of the OBD2 universe — anything beyond that lives here.

## Installing a profile

Tap the link to a `.json` profile file below, then on iOS:

1. Open the link on your iPhone (Safari, Mail, Messages — anywhere).
2. Tap the **Share** icon → **Open in OBD2 Logger**.
3. The profile installs to your app's `Documents/profiles/` and appears in the Profile picker the next time you Add a vehicle (or change a vehicle's profile).

You can also manually drop a `.json` file into **Files app → On My iPhone → OBD2 Logger → profiles/** — the app picks it up on next launch.

## Available profiles

> No community-contributed profiles yet. **Be the first** — see [CONTRIBUTING.md](./CONTRIBUTING.md).

When profiles land, this section will look like:

| Profile | Vehicle match | Contributor | Last validated | File |
|---|---|---|---|---|
| `honda-civic-hybrid-2024` | Honda Civic Hybrid 2024+ | @example | 2026-XX-XX | [json](./honda-civic-hybrid-2024.json) |
| `tesla-model-3` | Tesla Model 3 (2017+) | @example | 2026-XX-XX | [json](./tesla-model-3.json) |
| `bmw-i3-rex` | BMW i3 REx (2014–2021) | @example | 2026-XX-XX | [json](./bmw-i3-rex.json) |

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
