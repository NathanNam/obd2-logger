import SwiftUI

struct LoggingControlsView: View {
    @Bindable var settings = SettingsStore.shared
    var vehicleStore = VehicleStore.shared
    var profileRegistry = ProfileRegistry.shared
    var ble = BLEManager.shared
    var session = LoggingSession.shared
    let elm: ELM327

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Logging").font(.cardTitle)
                Spacer()
                statusLabel
            }

            HStack {
                Picker("Rate", selection: $settings.sampleRateHz) {
                    Text("0.5 Hz").tag(0.5)
                    Text("1 Hz").tag(1.0)
                    Text("2 Hz").tag(2.0)
                    Text("5 Hz").tag(5.0)
                }
                .pickerStyle(.menu)
                .disabled(isLogging)

                Toggle("Raw hex", isOn: $settings.rawCapture)
                    .disabled(isLogging)
                    .toggleStyle(.switch)
                    .labelsHidden()
                Text("Raw hex").font(.captionText).foregroundStyle(.secondary)

                Spacer()

                if isLogging {
                    Button("Stop") {
                        Task { await session.stop() }
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button("Start logging") {
                        startLogging()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canStart)
                }
            }

            if !isLogging {
                Text("Raw hex writes each PID's raw response bytes verbatim instead of decoded values — for verifying a profile or capturing a sweep.")
                    .font(.statusText)
                    .foregroundStyle(.tertiary)
            }

            if case .error(let msg) = session.state {
                Text(msg)
                    .font(.statusText)
                    .foregroundStyle(.red)
            }
            if case .preparing(let step) = session.state {
                Text(step)
                    .font(.statusText)
                    .foregroundStyle(.secondary)
            }
            if case .logging(let count, let id) = session.state {
                Text("rows: \(count) · id: \(id)")
                    .font(.monoSmall)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(12)
        .background(Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var isLogging: Bool {
        if case .logging = session.state { return true } else { return false }
    }

    private var canStart: Bool {
        if case .connected = ble.connectionState, settings.activeVehicleSlug != nil {
            return !isLogging
        }
        return false
    }

    private var statusLabel: some View {
        Group {
            switch session.state {
            case .idle:
                Text("Ready").font(.captionText).foregroundStyle(.secondary)
            case .preparing:
                Text("Preparing…").font(.captionText).foregroundStyle(.blue)
            case .logging:
                Text("Logging").font(.captionText).foregroundStyle(.green)
            case .error:
                Text("Error").font(.captionText).foregroundStyle(.red)
            }
        }
    }

    private func startLogging() {
        guard let slug = settings.activeVehicleSlug,
              let vehicle = vehicleStore.vehicles.first(where: { $0.slug == slug }),
              let profile = profileRegistry.profile(id: vehicle.profileId) else {
            return
        }
        Task {
            await session.start(
                vehicle: vehicle,
                profile: profile,
                elm: elm,
                sampleRateHz: settings.sampleRateHz,
                rawMode: settings.rawCapture
            )
        }
    }
}
