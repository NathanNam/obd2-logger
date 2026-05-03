import SwiftUI

struct VehicleManagerView: View {
    var settings = SettingsStore.shared
    var vehicleStore = VehicleStore.shared
    @State private var showAdd = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Vehicles").font(.subheadline.weight(.semibold))
                Spacer()
                Button("Add…") { showAdd = true }
                    .buttonStyle(.bordered)
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
        .onAppear {
            vehicleStore.reload(owner: settings.owner)
        }
    }
}
