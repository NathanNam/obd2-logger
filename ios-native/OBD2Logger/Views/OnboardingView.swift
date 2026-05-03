import SwiftUI

struct OnboardingView: View {
    var settings = SettingsStore.shared
    @State private var ownerInput: String = "me"
    @State private var error: String?

    var onDone: () -> Void

    var body: some View {
        ZStack {
            Color(red: 14 / 255, green: 15 / 255, blue: 18 / 255).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("Setup")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .textCase(.uppercase)
                Text("What should we call you?")
                    .font(.title2.weight(.semibold))
                Text("Used to label your data folder so you can share with friends later. Lowercase letters, digits, and dashes — like a folder name.")
                    .foregroundStyle(.secondary)
                Text("Your data lives inside the OBD2 Logger app folder, accessible from the iOS Files app under On My iPhone → OBD2 Logger.")
                    .font(.callout)
                    .foregroundStyle(.tertiary)

                TextField("owner", text: $ownerInput)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .keyboardType(.alphabet)

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Spacer()

                Button("Continue") {
                    let normalized = normalize(ownerInput)
                    if let err = validate(normalized) {
                        error = err
                        return
                    }
                    settings.owner = normalized
                    onDone()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

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
