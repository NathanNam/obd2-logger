import SwiftUI

struct ContentView: View {
    var settings = SettingsStore.shared
    @State private var onboardingComplete: Bool = !SettingsStore.shared.owner.isEmpty

    var body: some View {
        if !onboardingComplete {
            OnboardingView {
                onboardingComplete = true
            }
        } else {
            MainShellView()
        }
    }
}

#Preview {
    ContentView()
}
