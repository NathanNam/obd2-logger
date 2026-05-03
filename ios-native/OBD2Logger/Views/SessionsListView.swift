import SwiftUI

struct SessionsListView: View {
    var settings = SettingsStore.shared
    var session = LoggingSession.shared
    @State private var sessions: [SessionRecord] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Sessions").font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(sessions.count)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }
            if sessions.isEmpty {
                Text("No sessions yet for the active vehicle.")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                ForEach(sessions) { record in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.startUTC.replacingOccurrences(of: ".000Z", with: "Z"))
                                .font(.caption.monospaced())
                            Text("\(record.rowCount) rows · \(formatDuration(ms: record.durationMs))")
                                .font(.caption2.monospaced())
                                .foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Text(record.endedReason)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.tertiary)
                    }
                    .padding(8)
                    .background(Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
        }
        .onAppear { reload() }
        .onChange(of: session.state) { _, _ in reload() }
        .onChange(of: settings.activeVehicleSlug) { _, _ in reload() }
    }

    private func reload() {
        guard let slug = settings.activeVehicleSlug else {
            sessions = []
            return
        }
        let path = AppPath.sessionsManifest(settings.owner, slug)
        guard AppStorage.shared.exists(path),
              let text = try? AppStorage.shared.readText(path) else {
            sessions = []
            return
        }
        var loaded: [SessionRecord] = []
        for line in text.split(separator: "\n") {
            guard let data = line.trimmingCharacters(in: .whitespaces).data(using: .utf8) else { continue }
            if let record = try? JSONDecoder().decode(SessionRecord.self, from: data) {
                loaded.append(record)
            }
        }
        sessions = loaded.sorted { $0.startUTC > $1.startUTC }
    }

    private func formatDuration(ms: Int) -> String {
        let totalSec = ms / 1000
        let m = totalSec / 60
        let s = totalSec % 60
        return m == 0 ? "\(s)s" : "\(m)m \(s)s"
    }
}
