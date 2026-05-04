import SwiftUI

struct AddVehicleView: View {
    let elm: ELM327
    /// Optional callback fired right after a vehicle is successfully saved
    /// (and before the sheet dismisses itself). Onboarding uses this to
    /// know when its third step is complete.
    var onSaved: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    var settings = SettingsStore.shared
    var profileRegistry = ProfileRegistry.shared
    var vehicleStore = VehicleStore.shared
    var ble = BLEManager.shared

    @State private var year: String = ""
    @State private var make: String = ""
    @State private var model: String = ""
    @State private var trim: String = ""
    @State private var vin: String = ""
    @State private var profileID: String = "generic-obd2"
    @State private var error: String?

    @State private var status: AutoStatus = .idle
    @State private var lastDecodedVIN: String?

    enum AutoStatus: Equatable {
        case idle
        case readingVIN
        case vinReadFailed(String)
        case decoding
        case decoded
        case decodeFailed(String)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Vehicle") {
                    TextField("Year", text: $year)
                        .keyboardType(.numberPad)
                    TextField("Make (e.g. Toyota)", text: $make)
                    TextField("Model (e.g. Camry)", text: $model)
                    TextField("Trim (optional)", text: $trim)
                    TextField("VIN (optional)", text: $vin)
                        .autocapitalization(.allCharacters)
                        .autocorrectionDisabled()
                        .onChange(of: vin) { _, newValue in
                            handleVINChange(newValue)
                        }
                }
                if let statusText {
                    Section { Text(statusText).font(.statusText).foregroundStyle(statusColor) }
                }
                Section("Profile") {
                    Picker("Profile", selection: $profileID) {
                        ForEach(profileRegistry.profiles) { p in
                            Text(p.displayName).tag(p.profileId)
                        }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Add vehicle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                }
            }
            .onAppear {
                profileID = profileRegistry.suggestedProfile(make: nil, year: nil).profileId
                Task { await runVINReadIfConnected() }
            }
        }
    }

    private var statusText: String? {
        switch status {
        case .idle: return nil
        case .readingVIN: return "Reading VIN from vehicle…"
        case .vinReadFailed(let reason): return "Couldn't read VIN automatically: \(reason). Enter manually if you'd like."
        case .decoding: return "Decoding via NHTSA…"
        case .decoded: return "Decoded from NHTSA. Edit any field as needed."
        case .decodeFailed(let msg): return "NHTSA decode failed: \(msg). Fill in the fields manually."
        }
    }

    private var statusColor: Color {
        switch status {
        case .idle, .readingVIN, .decoding, .decoded: return .secondary
        case .vinReadFailed, .decodeFailed: return .orange
        }
    }

    private func handleVINChange(_ raw: String) {
        // Force uppercase without re-triggering the binding.
        let upper = raw.uppercased()
        if upper != raw { vin = upper; return }
        guard NHTSAClient.isValidVINFormat(upper), upper != lastDecodedVIN else { return }
        Task { await runDecode(vin: upper) }
    }

    private func runVINReadIfConnected() async {
        guard case .connected = ble.connectionState else {
            NSLog("[OBD2-VIN] auto-read skipped: BLE not connected (state=\(String(describing: ble.connectionState)))")
            return
        }
        // Don't clobber a VIN the user has already typed.
        guard vin.isEmpty else { return }
        NSLog("[OBD2-VIN] auto-read: starting")
        status = .readingVIN
        do {
            if let read = try await VINReader.read(elm: elm) {
                NSLog("[OBD2-VIN] auto-read: got VIN \(read)")
                vin = read
                await runDecode(vin: read)
            } else {
                NSLog("[OBD2-VIN] auto-read: VINReader returned nil (no 4902 prefix in response)")
                status = .vinReadFailed("ECU didn't return a parseable VIN")
            }
        } catch let err as ELMError {
            NSLog("[OBD2-VIN] auto-read: ELMError \(err)")
            status = .vinReadFailed(err.errorDescription ?? "ELM error")
        } catch {
            NSLog("[OBD2-VIN] auto-read: error \(error)")
            status = .vinReadFailed(error.localizedDescription)
        }
    }

    private func runDecode(vin candidate: String) async {
        status = .decoding
        do {
            let decoded = try await NHTSAClient.decode(vin: candidate)
            lastDecodedVIN = candidate
            applyDecoded(decoded)
            status = .decoded
        } catch let err as NHTSAClient.DecodeError {
            status = .decodeFailed(err.errorDescription ?? "unknown")
        } catch {
            status = .decodeFailed(error.localizedDescription)
        }
    }

    private func applyDecoded(_ decoded: NHTSAClient.Decoded) {
        if let y = decoded.year { year = String(y) }
        if !decoded.make.isEmpty { make = decoded.make }
        if !decoded.model.isEmpty { model = decoded.model }
        if !decoded.trim.isEmpty { trim = decoded.trim }
        let suggested = profileRegistry.suggestedProfile(make: decoded.make, year: decoded.year)
        profileID = suggested.profileId
    }

    private func save() {
        let yearInt = Int(year)
        let slug = Vehicle.makeSlug(year: yearInt, make: make.isEmpty ? nil : make, model: model.isEmpty ? nil : model)
        guard !slug.isEmpty else {
            error = "Need at least a year + make or model."
            return
        }
        guard let profile = profileRegistry.profile(id: profileID) else {
            error = "Pick a profile."
            return
        }
        let vehicle = Vehicle(
            slug: slug,
            owner: settings.owner,
            displayName: Vehicle.makeDisplayName(year: yearInt, make: make, model: model, trim: trim),
            year: yearInt,
            make: make.isEmpty ? nil : make,
            model: model.isEmpty ? nil : model,
            trim: trim.isEmpty ? nil : trim,
            vin: vin.isEmpty ? nil : vin,
            profileId: profile.profileId,
            profileVersion: profile.profileVersion,
            createdAtUTC: ISO8601DateFormatter.utcMs.string(from: Date()),
            lastUsedUTC: nil,
            supportedStandardPIDs: [],
            supportedProfilePIDs: [],
            disabledPIDs: []
        )
        do {
            try vehicleStore.save(vehicle)
            settings.activeVehicleSlug = vehicle.slug
            onSaved?()
            dismiss()
        } catch let err {
            error = err.localizedDescription
        }
    }
}
