import SwiftUI

struct MainShellView: View {
    let elm: ELM327
    var settings = SettingsStore.shared
    var vehicleStore = VehicleStore.shared
    var profileRegistry = ProfileRegistry.shared
    var ble = BLEManager.shared
    var session = LoggingSession.shared

    @State private var showResetConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header

                    if let error = profileRegistry.loadError {
                        Text("Profile error: \(error)")
                            .font(.statusText)
                            .foregroundStyle(.red)
                    }

                    // Connection first — the user always needs to know
                    // whether the adapter is alive before anything else
                    // matters. Vehicle + Logging follow.
                    ConnectionView(elm: elm)

                    VehicleCardView(elm: elm)

                    LoggingControlsView(elm: elm)

                    TripCardView()

                    LiveReadoutView()

                    SessionsListView()

                    resetFooter
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
        .alert("Reset app?", isPresented: $showResetConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Reset", role: .destructive) { performReset() }
        } message: {
            Text("Clears your name, active vehicle, and disconnects any adapter. CSV files and vehicle JSON on disk are kept — re-entering the same name brings them back. You'll restart the onboarding flow.")
        }
    }

    private var resetFooter: some View {
        HStack {
            Spacer()
            Button("Reset app") { showResetConfirm = true }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .foregroundStyle(.tertiary)
            Spacer()
        }
        .padding(.top, 8)
    }

    private func performReset() {
        // Stop in-flight session + tear down BLE so we don't leak the
        // adapter/socket state across the reset. Cleanup is async; the
        // owner-clear below will trigger ContentView to swap to
        // onboarding once SwiftUI re-evaluates anyway.
        Task { await session.stop(reason: "user_reset") }
        ble.disconnect()
        elm.detach()
        settings.activeVehicleSlug = nil
        settings.owner = ""
        vehicleStore.reload(owner: "")  // empties the in-memory list
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            HStack(spacing: 0) {
                Text("obd2").foregroundStyle(.white)
                Text("/logger").foregroundStyle(Color(red: 92 / 255, green: 196 / 255, blue: 1.0))
            }
            .font(.appBrand)
            Spacer()
            Text("owner: \(settings.owner)")
                .font(.monoSmall)
                .foregroundStyle(.tertiary)
        }
    }
}
