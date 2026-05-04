import SwiftUI

struct MainShellView: View {
    let elm: ELM327
    var settings = SettingsStore.shared
    var vehicleStore = VehicleStore.shared
    var profileRegistry = ProfileRegistry.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header

                    if let error = profileRegistry.loadError {
                        Text("Profile error: \(error)")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    // Connection first — the user always needs to know
                    // whether the adapter is alive before anything else
                    // matters. Vehicle + Logging follow.
                    ConnectionView(elm: elm)

                    VehicleCardView(elm: elm)

                    LoggingControlsView(elm: elm)

                    LiveReadoutView()

                    SessionsListView()
                }
                .padding(16)
            }
            .background(Color(red: 14 / 255, green: 15 / 255, blue: 18 / 255).ignoresSafeArea())
            .navigationTitle("")
            .toolbar(.hidden, for: .navigationBar)
        }
        .preferredColorScheme(.dark)
        .onAppear {
            vehicleStore.reload(owner: settings.owner)
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            HStack(spacing: 0) {
                Text("obd2").foregroundStyle(.white)
                Text("/logger").foregroundStyle(Color(red: 92 / 255, green: 196 / 255, blue: 1.0))
            }
            .font(.system(.title2, design: .monospaced, weight: .bold))
            Spacer()
            Text("owner: \(settings.owner)")
                .font(.caption.monospaced())
                .foregroundStyle(.tertiary)
        }
    }
}
