import SwiftUI

/// Three-step first-run onboarding:
///   1. Pick an owner name (used to namespace the data folder).
///   2. Pair an OBD2 BLE adapter and run ELM327 init against it.
///   3. Add a vehicle (VIN auto-read + NHTSA decode pre-fill).
///
/// Step 2 is a strict block — the app has no value without an adapter, so
/// we don't let the user proceed past it until the adapter is fully
/// initialized. The owner name is only persisted once step 2 succeeds, so
/// killing the app mid-flow restarts at step 1.
///
/// Step 3 is skippable. If the user bails (or kills the app), onboarding
/// is considered complete and the user lands on MainShell, where the
/// empty Vehicle card prompts "Tap to add your car" — same destination,
/// gentler fallback.
struct OnboardingView: View {
    let elm: ELM327
    var settings = SettingsStore.shared
    var ble = BLEManager.shared
    var vehicleStore = VehicleStore.shared

    enum Step {
        case name
        case pair
        case vehicle
    }

    @State private var step: Step = .name
    @State private var pendingOwner: String = "me"
    @State private var nameError: String?

    @State private var showPicker = false
    @State private var pairing: Pairing = .idle
    @State private var pairError: String?

    @State private var showAddVehicle = false

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
                case .vehicle:
                    vehicleStep
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
        .sheet(isPresented: $showAddVehicle) {
            AddVehicleView(elm: elm, onSaved: {
                // Vehicle saved → onboarding done. The sheet's own dismiss
                // will close the form on top of us; we close onboarding
                // shortly after so MainShell can take over.
                onDone()
            })
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
            stepDot(active: step == .name, done: step != .name, label: "1")
            stepLabel("Name", for: .name)
            connector
            stepDot(active: step == .pair, done: step == .vehicle, label: "2")
            stepLabel("Adapter", for: .pair)
            connector
            stepDot(active: step == .vehicle, done: false, label: "3")
            stepLabel("Vehicle", for: .vehicle)
        }
    }

    private var connector: some View {
        Rectangle().fill(Color.secondary.opacity(0.3)).frame(width: 12, height: 1)
    }

    @ViewBuilder
    private func stepLabel(_ text: String, for forStep: Step) -> some View {
        let order: [Step] = [.name, .pair, .vehicle]
        let cur = order.firstIndex(of: step) ?? 0
        let target = order.firstIndex(of: forStep) ?? 0
        if step == forStep {
            Text(text).font(.monoSmall).foregroundStyle(.primary)
        } else if target < cur {
            Text(text).font(.monoSmall).foregroundStyle(.secondary)
        } else {
            Text(text).font(.monoSmall).foregroundStyle(.tertiary)
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
                    Button("Next") {
                        // Persist owner only after the adapter is confirmed
                        // working — half-finished onboarding shouldn't leave
                        // a name behind in settings. From here on, the user
                        // is committed; if they bail out of step 3 we still
                        // call onDone() and they land on MainShell.
                        settings.owner = pendingOwner
                        vehicleStore.reload(owner: pendingOwner)
                        step = .vehicle
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

            // Always-visible escape hatch: lets a reviewer / curious user
            // explore the app end-to-end without an OBD2 adapter. Wires
            // ELM327 + BLEManager into demo mode so subsequent queries
            // return canned responses; flow continues normally from there.
            if pairing == .idle, !isPairing {
                Button("Don't have an adapter? Try demo mode") {
                    enterDemoMode()
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func enterDemoMode() {
        ble.enterDemoMode()
        elm.attach()  // log + lineBuffer reset; inboundTask is a no-op in demo
        pairing = .ready("DEMO ADAPTER")
    }

    private var scanButtonLabel: String {
        switch pairing {
        case .idle: return "Scan for adapter"
        case .connecting, .initializing: return "Working…"
        case .ready: return "Done"
        }
    }

    // MARK: - Step 3: add vehicle

    private var vehicleStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Add your car")
                .font(.stepTitle)
            Text("With the adapter connected, the app can read your VIN over OBD2 and decode year, make, model, and trim from the free NHTSA vPIC service. You can edit any field before saving.")
                .foregroundStyle(.secondary)

            if !vehicleStore.vehicles.isEmpty {
                // The user already saved a vehicle in this onboarding pass
                // (e.g. they hit Add, saved, then re-opened the form). Show
                // a confirmation so the flow has a clean exit.
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Saved: \(vehicleStore.vehicles.first?.displayName ?? "your vehicle")")
                        .font(.bodyText)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            VStack(spacing: 8) {
                Button(vehicleStore.vehicles.isEmpty ? "Add vehicle" : "Add another") {
                    showAddVehicle = true
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)

                Button(vehicleStore.vehicles.isEmpty ? "Skip for now" : "Done") {
                    onDone()
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
            }
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
