import SwiftUI

struct AddVehicleView: View {
    @Environment(\.dismiss) private var dismiss
    var settings = SettingsStore.shared
    var profileRegistry = ProfileRegistry.shared
    var vehicleStore = VehicleStore.shared

    @State private var year: String = ""
    @State private var make: String = ""
    @State private var model: String = ""
    @State private var trim: String = ""
    @State private var vin: String = ""
    @State private var profileID: String = "generic-obd2"
    @State private var error: String?

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
            }
        }
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
            dismiss()
        } catch let err {
            error = err.localizedDescription
        }
    }
}
