import SwiftUI

@main
struct OBD2LoggerApp: App {
    @State private var importBanner: ImportBanner?

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    handleImport(url: url)
                }
                .overlay(alignment: .top) {
                    if let banner = importBanner {
                        bannerView(banner)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
        }
    }

    private func handleImport(url: URL) {
        // Only act on .json — iOS may forward other UTIs through the same hook.
        guard url.pathExtension.lowercased() == "json" else { return }
        do {
            let profile = try ProfileImporter.importProfile(from: url)
            ProfileRegistry.shared.reload()
            importBanner = .success("Imported profile: \(profile.displayName)")
        } catch {
            let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            importBanner = .failure("Import failed: \(msg)")
        }
        // Auto-dismiss after a few seconds.
        Task {
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            await MainActor.run {
                if importBanner != nil {
                    withAnimation { importBanner = nil }
                }
            }
        }
    }

    @ViewBuilder
    private func bannerView(_ banner: ImportBanner) -> some View {
        let (text, color): (String, Color) = {
            switch banner {
            case .success(let msg): return (msg, .green)
            case .failure(let msg): return (msg, .red)
            }
        }()
        Text(text)
            .font(.bodyText)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(color.opacity(0.9))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .frame(maxWidth: .infinity)
    }
}

private enum ImportBanner: Equatable {
    case success(String)
    case failure(String)
}
