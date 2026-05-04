import SwiftUI

/// Compact, tappable card for the main shell that summarizes the active
/// vehicle and opens the full management sheet on tap. Add / Import /
/// Re-probe used to live as three buttons up front; that's a lot of
/// chrome for a feature most users touch a handful of times. The card
/// is the single entry point now; everything else hides behind it.
struct VehicleCardView: View {
    let elm: ELM327
    var settings = SettingsStore.shared
    var vehicleStore = VehicleStore.shared

    @State private var showManager = false

    var body: some View {
        Button {
            showManager = true
        } label: {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Vehicle")
                        .font(.monoSmall)
                        .foregroundStyle(.tertiary)
                        .textCase(.uppercase)
                    if let active = activeVehicle {
                        Text(active.displayName)
                            .font(.valueLabel)
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Text("\(active.slug) · \(active.profileId)")
                            .font(.monoSmall)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    } else if vehicleStore.vehicles.isEmpty {
                        Text("No vehicle yet")
                            .font(.valueLabel)
                            .foregroundStyle(.primary)
                        Text("Tap to add your car")
                            .font(.monoSmall)
                            .foregroundStyle(.tertiary)
                    } else {
                        Text("Pick an active vehicle")
                            .font(.valueLabel)
                            .foregroundStyle(.primary)
                        Text("\(vehicleStore.vehicles.count) saved · tap to choose")
                            .font(.monoSmall)
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.captionText.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showManager) {
            VehicleManagerSheet(elm: elm)
        }
        .onAppear {
            vehicleStore.reload(owner: settings.owner)
        }
    }

    private var activeVehicle: Vehicle? {
        guard let slug = settings.activeVehicleSlug else { return nil }
        return vehicleStore.vehicles.first { $0.slug == slug }
    }
}
