import SwiftUI

/// Sheet that lets the user pick a discovered BLE device. Lives only while
/// scanning; auto-stops scan on dismiss.
struct DevicePickerView: View {
    @Environment(\.dismiss) private var dismiss
    let ble = BLEManager.shared
    let onPick: (BLEManager.DiscoveredDevice) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if ble.discovered.isEmpty {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Scanning for OBD2 adapters…")
                            .font(.bodyText)
                            .foregroundStyle(.secondary)
                        Text("Hold your phone close to the adapter and key the car to ON.")
                            .font(.statusText)
                            .foregroundStyle(.tertiary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(ble.discovered) { device in
                        Button {
                            onPick(device)
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(device.name)
                                        .foregroundStyle(.primary)
                                    Text(device.id.uuidString.prefix(13) + "…")
                                        .font(.monoSmall)
                                        .foregroundStyle(.tertiary)
                                }
                                Spacer()
                                Text("\(device.rssi) dB")
                                    .font(.captionText)
                                    .foregroundStyle(.secondary)
                                    .monospaced()
                            }
                            .contentShape(Rectangle())
                        }
                    }
                }
            }
            .navigationTitle("Choose adapter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        ble.stopScan()
                        dismiss()
                    }
                }
            }
        }
        .onAppear {
            Task { _ = await ble.awaitPowerStateSettled(); ble.startScan() }
        }
        .onDisappear {
            ble.stopScan()
        }
    }
}
