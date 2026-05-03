import SwiftUI

struct ConnectionView: View {
    let ble = BLEManager.shared
    @State private var elm = ELM327()
    @State private var showPicker = false
    @State private var statusError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                statusBadge
                Spacer()
                connectionButton
            }

            if let statusError {
                Text(statusError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(8)
                    .background(Color.red.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            DisclosureGroup("Adapter log (\(elm.log.count))") {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(elm.log) { entry in
                            HStack(alignment: .top, spacing: 8) {
                                Text(entry.direction.rawValue.uppercased())
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(color(for: entry.direction))
                                    .frame(width: 36, alignment: .leading)
                                Text(entry.text)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(entry.direction == .err ? .red : .primary)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 240)
                .padding(8)
                .background(Color.black.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .sheet(isPresented: $showPicker) {
            DevicePickerView { device in
                statusError = nil
                Task { await connect(to: device) }
            }
        }
    }

    private var statusBadge: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(badgeColor)
                .frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(stateTitle)
                    .font(.system(.callout, design: .monospaced).weight(.semibold))
                Text(stateSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var connectionButton: some View {
        switch ble.connectionState {
        case .idle, .error:
            Button("Connect adapter…") {
                statusError = nil
                showPicker = true
            }
            .buttonStyle(.borderedProminent)
        case .scanning, .connecting, .discovering:
            Button("Cancel") {
                ble.disconnect()
            }
            .buttonStyle(.bordered)
        case .connected:
            Button("Disconnect") {
                elm.detach()
                ble.disconnect()
            }
            .buttonStyle(.bordered)
        }
    }

    private var stateTitle: String {
        switch ble.connectionState {
        case .idle: return "idle"
        case .scanning: return "scanning"
        case .connecting(let n): return "connecting → \(n)"
        case .discovering(let n): return "discovering → \(n)"
        case .connected(let n, _): return "connected: \(n)"
        case .error: return "error"
        }
    }

    private var stateSubtitle: String {
        switch ble.connectionState {
        case .idle: return "Tap Connect adapter to start."
        case .scanning: return "Looking for nearby OBD2 devices."
        case .connecting: return "Negotiating GATT…"
        case .discovering: return "Discovering services and characteristics…"
        case .connected(_, let picked):
            return "service=\(short(picked.serviceUUID)) tx=\(short(picked.txUUID)) rx=\(short(picked.rxUUID)) (\(picked.source.rawValue))"
        case .error(let msg): return msg
        }
    }

    private var badgeColor: Color {
        switch ble.connectionState {
        case .idle: return .secondary
        case .scanning, .connecting, .discovering: return .blue
        case .connected: return .green
        case .error: return .red
        }
    }

    private func color(for direction: ELM327.Direction) -> Color {
        switch direction {
        case .tx: return .blue
        case .rx: return .green
        case .info: return .secondary
        case .err: return .red
        }
    }

    private func short(_ uuid: String) -> String {
        // 16-bit UUID short form: "0000XXXX-..."
        if uuid.count > 8, uuid.hasPrefix("0000"), uuid.contains("-0000-1000-8000-00805F9B34FB") {
            return "0x" + String(uuid.dropFirst(4).prefix(4))
        }
        return String(uuid.prefix(8)) + "…"
    }

    private func connect(to device: BLEManager.DiscoveredDevice) async {
        do {
            _ = try await ble.connect(device)
            elm.attach()
            _ = try await elm.initSequence()
        } catch {
            statusError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
