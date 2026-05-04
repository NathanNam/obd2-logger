import SwiftUI

struct ContentView: View {
    var settings = SettingsStore.shared
    // Shared ELM327 owned at the top so onboarding's pair-and-init step
    // and MainShellView's connection card use the same instance — without
    // this, MainShellView would have to re-init against an already-paired
    // adapter, and double-attaching to BLEManager's inboundStream silently
    // breaks framing.
    @State private var elm = ELM327()
    @State private var onboardingComplete: Bool = !SettingsStore.shared.owner.isEmpty

    var body: some View {
        if !onboardingComplete {
            OnboardingView(elm: elm) {
                onboardingComplete = true
            }
        } else {
            MainShellView(elm: elm)
        }
    }
}

#Preview {
    ContentView()
}
