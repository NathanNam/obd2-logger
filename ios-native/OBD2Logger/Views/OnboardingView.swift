import SwiftUI

/// Two-step first-run onboarding:
///   1. Pick an owner name (used to namespace the data folder).
///   2. Pair an OBD2 BLE adapter and run ELM327 init against it.
///
/// Step 2 is a strict block — the app has no value without an adapter, so
/// we don't let the user proceed to MainShell until the adapter is fully
/// initialized. The owner name is only persisted once step 2 succeeds, so
/// killing the app mid-flow restarts at step 1.
struct OnboardingView: View {
    let elm: ELM327
    var settings = SettingsStore.shared
    var ble = BLEManager.shared

    enum Step {
        case name
        case pair
    }

    @State private var step: Step = .name
    @State private var pendingOwner: String = "me"
    @State private var nameError: String?

    @State private var showPicker = false
    @State private var pairing: Pairing = .idle
    @State private var pairError: String?

    /// Tracks the BLE/ELM init flow for the onboarding-pair step.
    enum Pairing: Equatable {
        case idle
        case connecting(String)
        case initializing(String)
        case ready(String)
    }

    var onDone: () -> Void

    var body: some View {
        ZStack {
            Color(red: 14 / 255, green: 15 / 255, blue: 18 / 255).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                stepIndicator
                switch step {
                case .name:
                    nameStep
                case .pair:
                    pairStep
                }
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showPicker) {
            DevicePickerView { device in
                Task { await connect(to: device) }
            }
        }
    }

    // MARK: - Step indicator

    private var stepIndicator: some View {
        HStack(spacing: 8) {
            Text("Setup")
                .font(.monoSmall)
                .foregroundStyle(.tertiary)
                .textCase(.uppercase)
            Spacer()
            stepDot(active: step == .name, done: step == .pair, label: "1")
            Text("Name")
                .font(.monoSmall)
                .foregroundStyle(step == .name ? .primary : .secondary)
            Rectangle().fill(Color.secondary.opacity(0.3)).frame(width: 16, height: 1)
            stepDot(active: step == .pair, done: false, label: "2")
            Text("Adapter")
                .font(.monoSmall)
                .foregroundStyle(step == .pair ? .primary : .tertiary)
        }
    }

    private func stepDot(active: Bool, done: Bool, label: String) -> some View {
        ZStack {
            Circle()
                .fill(done ? Color.green : (active ? Color.accentColor : Color.secondary.opacity(0.3)))
                .frame(width: 18, height: 18)
            Text(label)
                .font(.monoTiny.weight(.bold))
                .foregroundStyle(.white)
        }
    }

    // MARK: - Step 1: name

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("What should we call you?")
                .font(.stepTitle)
            Text("Used to label your data folder so you can share with friends later. Lowercase letters, digits, and dashes — like a folder name.")
                .foregroundStyle(.secondary)
            Text("Your data lives inside the OBD2 Logger app folder, accessible from the iOS Files app under On My iPhone → OBD2 Logger.")
                .font(.bodyText)
                .foregroundStyle(.tertiary)

            TextField("owner", text: $pendingOwner)
                .textFieldStyle(.roundedBorder)
                .autocapitalization(.none)
                .autocorrectionDisabled()
                .keyboardType(.alphabet)

            if let nameError {
                Text(nameError)
                    .font(.statusText)
                    .foregroundStyle(.red)
            }

            Spacer()

            Button("Continue") {
                let normalized = normalize(pendingOwner)
                if let err = validate(normalized) {
                    nameError = err
                    return
                }
                pendingOwner = normalized
                nameError = nil
                step = .pair
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Step 2: pair adapter

    private var pairStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Pair your OBD2 adapter")
                .font(.stepTitle)
            Text("Plug the adapter into your car's OBD2 port and key the ignition to ON (or push-start to READY for hybrids). The adapter's LED should light up.")
                .foregroundStyle(.secondary)

            switch pairing {
            case .idle:
                Text("Tap below to scan for nearby BLE adapters.")
                    .font(.bodyText)
                    .foregroundStyle(.tertiary)
            case .connecting(let name):
                statusLine(spinner: true, label: "Connecting to \(name)…")
            case .initializing(let name):
                statusLine(spinner: true, label: "Initializing \(name) (ATZ → ATCAF1)…")
            case .ready(let name):
                statusLine(spinner: false, label: "✓ \(name) ready.")
            }

            if let pairError {
                Text(pairError)
                    .font(.statusText)
                    .foregroundStyle(.red)
                    .padding(8)
                    .background(Color.red.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            Spacer()

            HStack {
                Button("Back") {
                    pairing = .idle
                    pairError = nil
                    step = .name
                }
                .buttonStyle(.bordered)

                Spacer()

                if case .ready = pairing {
                    Button("Done") {
                        // Persist owner only after the adapter is confirmed
                        // working — half-finished onboarding shouldn't leave
                        // a name behind in settings.
                        settings.owner = pendingOwner
                        onDone()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                } else {
                    Button(scanButtonLabel) {
                        pairError = nil
                        showPicker = true
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(isPairing)
                }
            }
        }
    }

    private var scanButtonLabel: String {
        switch pairing {
        case .idle: return "Scan for adapter"
        case .connecting, .initializing: return "Working…"
        case .ready: return "Done"
        }
    }

    private var isPairing: Bool {
        switch pairing {
        case .connecting, .initializing: return true
        default: return false
        }
    }

    private func statusLine(spinner: Bool, label: String) -> some View {
        HStack(spacing: 10) {
            if spinner { ProgressView() }
            Text(label)
                .font(.bodyText)
                .foregroundStyle(.secondary)
        }
    }

    private func connect(to device: BLEManager.DiscoveredDevice) async {
        pairing = .connecting(device.name)
        do {
            _ = try await ble.connect(device)
            pairing = .initializing(device.name)
            elm.attach()
            _ = try await elm.initSequence()
            pairing = .ready(device.name)
        } catch {
            pairing = .idle
            pairError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func normalize(_ raw: String) -> String {
        let lower = raw.lowercased()
        let allowed = lower.unicodeScalars.map { c -> Character in
            if (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-" { return Character(c) }
            return "-"
        }
        let collapsed = String(allowed).replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
        return String(collapsed.trimmingCharacters(in: .init(charactersIn: "-")).prefix(32))
    }

    private func validate(_ owner: String) -> String? {
        if owner.isEmpty { return "Pick a name." }
        if owner.count < 2 { return "At least 2 characters." }
        return nil
    }
}
