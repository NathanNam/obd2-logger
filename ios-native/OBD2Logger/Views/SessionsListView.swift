import SwiftUI

struct SessionsListView: View {
    var settings = SettingsStore.shared
    var session = LoggingSession.shared
    @State private var sessions: [SessionRecord] = []
    @State private var page: Int = 0

    private let pageSize = 10

    private var pageCount: Int {
        max(1, (sessions.count + pageSize - 1) / pageSize)
    }

    private var pageSlice: [SessionRecord] {
        let start = page * pageSize
        let end = min(start + pageSize, sessions.count)
        guard start < end else { return [] }
        return Array(sessions[start..<end])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Sessions").font(.cardTitle)
                Spacer()
                Text("\(sessions.count)")
                    .font(.monoSmall)
                    .foregroundStyle(.tertiary)
            }
            if sessions.isEmpty {
                Text("No sessions yet for the active vehicle.")
                    .font(.bodyText)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                ForEach(pageSlice) { record in
                    sessionRow(record)
                }
                if pageCount > 1 {
                    paginationBar
                }
            }
        }
        .onAppear { reload() }
        .onChange(of: session.state) { _, _ in reload() }
        .onChange(of: settings.activeVehicleSlug) { _, _ in reload() }
    }

    private var paginationBar: some View {
        HStack {
            Button {
                page = max(0, page - 1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(page == 0)

            Spacer()

            Text("Page \(page + 1) of \(pageCount)")
                .font(.monoSmall)
                .foregroundStyle(.tertiary)

            Spacer()

            Button {
                page = min(pageCount - 1, page + 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(page >= pageCount - 1)
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private func sessionRow(_ record: SessionRecord) -> some View {
        // Tap a row → iOS share sheet (AirDrop / Mail / Save to Files /
        // copy / etc.) for the session's CSV. Same UX as long-pressing or
        // tapping a file in the Files app.
        let url = sessionFileURL(for: record)
        ShareLink(item: url) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(record.startUTC.replacingOccurrences(of: ".000Z", with: "Z"))
                        .font(.monoSmall)
                        .foregroundStyle(.primary)
                    Text("\(record.rowCount) rows · \(formatDuration(ms: record.durationMs))")
                        .font(.monoTiny)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                Text(record.endedReason)
                    .font(.monoTiny)
                    .foregroundStyle(.tertiary)
                Image(systemName: "square.and.arrow.up")
                    .font(.captionText)
                    .foregroundStyle(.tertiary)
            }
            .padding(8)
            .background(Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }

    /// Resolve a session record's relative `file` path (e.g.
    /// `sessions/2026-05-04T...csv`) to the on-disk URL inside the app's
    /// Documents directory.
    private func sessionFileURL(for record: SessionRecord) -> URL {
        let owner = settings.owner
        let slug = settings.activeVehicleSlug ?? ""
        let relative = "data/\(owner)/\(slug)/\(record.file)"
        return AppStorage.shared.url(for: relative)
    }

    private func reload() {
        guard let slug = settings.activeVehicleSlug else {
            sessions = []
            page = 0
            return
        }
        let path = AppPath.sessionsManifest(settings.owner, slug)
        guard AppStorage.shared.exists(path),
              let text = try? AppStorage.shared.readText(path) else {
            sessions = []
            page = 0
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
        // Clamp page if a deletion shrank the list past our current page.
        if page >= pageCount { page = max(0, pageCount - 1) }
    }

    private func formatDuration(ms: Int) -> String {
        let totalSec = ms / 1000
        let m = totalSec / 60
        let s = totalSec % 60
        return m == 0 ? "\(s)s" : "\(m)m \(s)s"
    }
}
