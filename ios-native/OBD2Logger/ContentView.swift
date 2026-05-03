import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color(red: 14 / 255, green: 15 / 255, blue: 18 / 255)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text("obd2")
                        .foregroundStyle(.white)
                    Text("/logger")
                        .foregroundStyle(Color(red: 92 / 255, green: 196 / 255, blue: 1.0))
                }
                .font(.system(.title, design: .monospaced, weight: .bold))

                Text("Phase 1 — Xcode scaffold")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 8) {
                    Bullet(label: "Project", value: "OBD2Logger.xcodeproj")
                    Bullet(label: "Bundle ID", value: "com.nathannam.obd2logger")
                    Bullet(label: "Min iOS", value: "17.0")
                    Bullet(label: "Next", value: "Phase 2 — BLE transport (CoreBluetooth + ELM327)")
                }
                .font(.system(.callout, design: .monospaced))
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .preferredColorScheme(.dark)
    }
}

private struct Bullet: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 90, alignment: .leading)
            Text(value)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

#Preview {
    ContentView()
}
