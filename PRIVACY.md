# Privacy Policy

_Last updated: 2026-05-04_

OBD2 Logger is built and maintained by Nathan (Daehyun) Nam. This privacy policy applies to both the iOS app and the web app published from this repository.

## TL;DR

- **We don't collect, transmit, or store your data.**
- All vehicle telemetry, session CSVs, and vehicle records stay on your device.
- The only outbound network request the app makes (besides loading itself) is one VIN-decode lookup per vehicle to NHTSA's free public vPIC API. The VIN is not sent anywhere else, and NHTSA's response is stored only in your local vehicle record.
- Location, when used, is used only as a system keep-alive while a logging session is active. Location data is never written to disk, sent to a server, or attached to the CSV.

## What the app accesses

### Bluetooth (required)
The app uses Bluetooth Low Energy to communicate with an ELM327 OBD2 adapter that you plug into your vehicle's OBD2 port. Communication is local to your device and the adapter; nothing is sent off-device. iOS asks for Bluetooth permission via the system prompt the first time you tap Connect.

### Location (iOS only, optional but enabled by default)
While a logging session is active, the iOS app starts a `CLLocationManager` and holds a location subscription. This is the same Apple-sanctioned pattern trip-tracking apps (Strava, Waze) use to keep working when the user switches to another app or locks the phone — the location indicator shows in the system status bar the entire time.

We do **not** read or store the location values. The `LocationKeepAlive` class in the source code keeps only the most recent fix in memory and never writes it anywhere — not to the CSV, not to disk, not to a server. Its sole purpose is to keep the OBD2 polling loop alive while the app is backgrounded.

You can revoke location permission at any time in iOS Settings → Privacy & Security → Location Services → OBD2 Logger.

### Files (your data folder)
- **iOS**: vehicle records, sessions manifest, and CSV logs are written under the app's container. They're visible in the Files app under On My iPhone → OBD2 Logger.
- **Web**: vehicle records and CSV logs are written into a folder you pick using the browser's File System Access API. The app cannot read or write any other folder.

## What we send to third parties

### NHTSA vPIC (one VIN decode per vehicle, opt-out available)
When you add a new vehicle, the app sends the 17-character VIN to <https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/{VIN}> to pre-fill year, make, model, and trim. NHTSA's vPIC service is a free public US-government API; their privacy policy is at <https://www.nhtsa.gov/privacy-policy>.

- The VIN is sent only on this single call, only when you add a vehicle.
- The decoded response is stored on your device only (in the vehicle record).
- You can decline the auto-decode in the iOS app's Add Vehicle form by typing values manually, and globally in the web app at Settings → VIN auto-decode.

### Nothing else leaves the device
There is no analytics, no crash reporting, no telemetry sent to us or any other third party. The app does not phone home.

## Data retention and deletion

- All data is on your device. Deleting the app deletes its data.
- iOS app: tap **Reset app** at the bottom of the main screen to clear your owner name and active vehicle, then re-onboard. CSV files on disk are kept by default; you can delete them via the Files app.
- Web app: clear the picked folder using your OS file manager.

## Children's privacy

OBD2 Logger is a vehicle-diagnostics utility and is not directed at children under 13. We do not knowingly collect data from anyone, regardless of age.

## Changes to this policy

We may update this document as the apps evolve. The "Last updated" date at the top reflects the most recent change. Material changes (e.g. new outbound calls, new permissions) will also be called out in the release notes.

## Contact

Privacy questions or requests: **nathan.dh.nam@gmail.com**

Source code, issue tracker, and release notes: <https://github.com/NathanNam/obd2-logger>
