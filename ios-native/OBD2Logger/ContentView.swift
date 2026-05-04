import SwiftUI

struct ContentView: View {
    var settings = SettingsStore.shared
    // Shared ELM327 owned at the top so onboarding's pair-and-init step
    // and MainShellView's connection card use the same instance — without
    // this, MainShellView would have to re-init against an already-paired
    // adapter, and double-attaching to BLEManager's inboundStream silently
    // breaks framing.
    @State private var elm = ELM327()

    /// Whether onboarding is complete. Derived directly from
    /// `settings.owner` (which is @Observable) so the "Reset app" footer
    /// can simply clear `owner` and SwiftUI re-routes us back to the
    /// OnboardingView automatically — no separate state to coordinate.
    private var onboardingComplete: Bool { !settings.owner.isEmpty }

    var body: some View {
        if !onboardingComplete {
            OnboardingView(elm: elm) {
                // No-op: completing the onboarding now just persists owner,
                // and the computed `onboardingComplete` flips on its own.
            }
        } else {
            MainShellView(elm: elm)
        }
    }
}

#Preview {
    ContentView()
}
