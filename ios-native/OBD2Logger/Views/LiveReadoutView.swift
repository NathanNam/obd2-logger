import SwiftUI

struct LiveReadoutView: View {
    var session = LoggingSession.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Live readout").font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(session.liveValues.count) PIDs")
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }
            if session.liveValues.isEmpty {
                Text("Start logging to see live values.")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                let sorted = session.liveValues.values.sorted { $0.displayName < $1.displayName }
                let columns = [GridItem(.adaptive(minimum: 150), spacing: 6)]
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(Array(sorted.enumerated()), id: \.offset) { _, live in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(live.displayName)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                            HStack(alignment: .firstTextBaseline, spacing: 2) {
                                Text(formatValue(live.value))
                                    .font(.callout.monospaced().weight(.semibold))
                                    .foregroundStyle(.primary)
                                if !live.unit.isEmpty {
                                    Text(live.unit)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
        }
    }

    private func formatValue(_ v: Double?) -> String {
        guard let v else { return "—" }
        if v.rounded() == v && abs(v) < 1e9 { return String(Int(v)) }
        return String(format: "%.2f", v)
    }
}
