import SwiftUI
import UniformTypeIdentifiers

/// Sheet body for the vehicle-management flow. Presented from
/// `VehicleCardView` when the user taps the active-vehicle card on the
/// main shell. Houses the three actions that used to clutter the main
/// shell — Add, Import profile, Re-probe — in one place.
struct VehicleManagerSheet: View {
    let elm: ELM327
    @Environment(\.dismiss) private var dismiss
    var settings = SettingsStore.shared
    var vehicleStore = VehicleStore.shared
    var profileRegistry = ProfileRegistry.shared

    @State private var showAdd = false
    @State private var showImporter = false
    @State private var statusMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    actionRow

                    if let statusMessage {
                        Text(statusMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.secondary.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }

                    if vehicleStore.vehicles.isEmpty {
                        Text("No vehicles yet. Tap **Add vehicle** to set one up — VIN auto-read + NHTSA decode pre-fill the year, make, and model.")
                            .font(.callout)
                            .foregroundStyle(.tertiary)
                            .padding(.vertical, 16)
                    } else {
                        ForEach(vehicleStore.vehicles) { vehicle in
                            vehicleRow(vehicle)
                        }
                    }
                }
                .padding(16)
            }
            .background(Color(red: 14 / 255, green: 15 / 255, blue: 18 / 255).ignoresSafeArea())
            .navigationTitle("Vehicles")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showAdd) {
            AddVehicleView(elm: elm)
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
                    statusMessage = "Imported: \(profile.displayName)"
                } catch {
                    statusMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            case .failure(let error):
                statusMessage = error.localizedDescription
            }
        }
        .onAppear {
            vehicleStore.reload(owner: settings.owner)
        }
    }

    private var actionRow: some View {
        HStack(spacing: 8) {
            Button {
                showAdd = true
            } label: {
                Label("Add vehicle", systemImage: "plus.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            Button {
                showImporter = true
            } label: {
                Image(systemName: "square.and.arrow.down")
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .help("Import a profile JSON")
        }
    }

    private func vehicleRow(_ vehicle: Vehicle) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(vehicle.displayName)
                        .font(.callout.weight(.semibold))
                    Text(vehicle.slug + " · " + vehicle.profileId)
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                    Text("\(vehicle.supportedStandardPIDs.count) std · \(vehicle.supportedProfilePIDs.count) profile PIDs cached")
                        .font(.caption2.monospaced())
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
            Button("Re-probe PIDs") {
                reprobePIDs(for: vehicle)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(12)
        .background(Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func reprobePIDs(for vehicle: Vehicle) {
        // Clear the cached supported lists so the next session re-runs
        // the (now ATSH-aware) standard discovery + profile probe from
        // scratch. Useful when an early session populated the cache via
        // the old broadcast-addressed probe and produced false positives.
        do {
            try vehicleStore.clearPIDCaches(slug: vehicle.slug, owner: vehicle.owner)
            statusMessage = "Cleared PID cache for \(vehicle.displayName). Next logging session will re-discover."
        } catch {
            statusMessage = "Re-probe failed: \(error.localizedDescription)"
        }
    }
}
