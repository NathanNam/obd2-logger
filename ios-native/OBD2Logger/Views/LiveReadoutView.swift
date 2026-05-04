import SwiftUI

struct LiveReadoutView: View {
    var session = LoggingSession.shared

    /// Display order matches the web app: Engine first, hybrid drivetrain
    /// next, battery, then transmission/emissions/diagnostics.
    private static let categoryOrder: [PidCategory] = [
        .engine, .hybrid, .battery, .transmission, .emissions, .diagnostics, .other,
    ]

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
                let grouped = groupByCategory(session.liveValues)
                ForEach(Self.categoryOrder, id: \.self) { category in
                    if let bucket = grouped[category], !bucket.isEmpty {
                        categorySection(category: category, values: bucket)
                    }
                }
            }
        }
    }

    private func categorySection(category: PidCategory, values: [Sampler.LiveValue]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(category.rawValue.capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text("(\(values.count))")
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }
            let columns = [GridItem(.adaptive(minimum: 150), spacing: 6)]
            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(values, id: \.pidID) { live in
                    cell(for: live)
                }
            }
        }
    }

    private func cell(for live: Sampler.LiveValue) -> some View {
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

    private func groupByCategory(_ values: [String: Sampler.LiveValue]) -> [PidCategory: [Sampler.LiveValue]] {
        var out: [PidCategory: [Sampler.LiveValue]] = [:]
        for (_, live) in values {
            out[live.category, default: []].append(live)
        }
        for key in out.keys {
            out[key]?.sort { $0.displayName < $1.displayName }
        }
        return out
    }

    private func formatValue(_ v: Double?) -> String {
        guard let v else { return "—" }
        if v.rounded() == v && abs(v) < 1e9 { return String(Int(v)) }
        return String(format: "%.2f", v)
    }
}
