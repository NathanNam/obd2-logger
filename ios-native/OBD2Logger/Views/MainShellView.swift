import SwiftUI

struct MainShellView: View {
    var settings = SettingsStore.shared
    var vehicleStore = VehicleStore.shared
    var profileRegistry = ProfileRegistry.shared
    @State private var elm = ELM327()

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

                    VehicleManagerView()

                    ConnectionView()

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
            elm.attach()
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
