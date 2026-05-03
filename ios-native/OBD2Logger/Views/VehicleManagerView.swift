import SwiftUI
import UniformTypeIdentifiers

struct VehicleManagerView: View {
    var settings = SettingsStore.shared
    var vehicleStore = VehicleStore.shared
    var profileRegistry = ProfileRegistry.shared
    @State private var showAdd = false
    @State private var showImporter = false
    @State private var importMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Vehicles").font(.subheadline.weight(.semibold))
                Spacer()
                Button("Import profile…") { showImporter = true }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("Add…") { showAdd = true }
                    .buttonStyle(.bordered)
            }
            if let importMessage {
                Text(importMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if vehicleStore.vehicles.isEmpty {
                Text("No vehicles yet. Tap Add to set one up.")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                ForEach(vehicleStore.vehicles) { vehicle in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(vehicle.displayName)
                                .font(.callout.weight(.semibold))
                            Text(vehicle.slug + " · " + vehicle.profileId)
                                .font(.caption.monospaced())
                                .foregroundStyle(.tertiary)
                        }
                        Spacer()
                        if settings.activeVehicleSlug == vehicle.slug {
                            Text("ACTIVE")
                                .font(.caption2.monospaced())
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.green.opacity(0.2))
                                .foregroundStyle(.green)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        } else {
                            Button("Activate") {
                                settings.activeVehicleSlug = vehicle.slug
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    }
                    .padding(10)
                    .background(Color(red: 28 / 255, green: 31 / 255, blue: 38 / 255))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .sheet(isPresented: $showAdd) {
            AddVehicleView()
                .onDisappear {
                    vehicleStore.reload(owner: settings.owner)
                }
        }
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                do {
                    let profile = try ProfileImporter.importProfile(from: url)
                    profileRegistry.reload()
                    importMessage = "Imported: \(profile.displayName)"
                } catch {
                    importMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            case .failure(let error):
                importMessage = error.localizedDescription
            }
        }
        .onAppear {
            vehicleStore.reload(owner: settings.owner)
        }
    }
}
