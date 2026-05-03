import Foundation

/// Writes a CSV one row at a time, with a 1-second flush cadence to keep
/// FileHandle write costs bounded.
final class CSVWriter {

    private let handle: FileHandle
    private let columnIDs: [String]
    private let metadata: [(key: String, value: String)]
    private(set) var rowCount: Int = 0
    private var buffer = ""
    private var lastFlush = Date()
    private var closed = false
    private let flushInterval: TimeInterval = 1.0

    static func create(
        path: String,
        columnIDs: [String],
        metadata: [String: String] = [:]
    ) throws -> CSVWriter {
        let url = AppStorage.shared.url(for: path)
        let parent = url.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: parent.path) {
            try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        }
        // Truncate-create the file.
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        let writer = CSVWriter(handle: handle, columnIDs: columnIDs, metadata: metadata)
        try writer.writeHeader()
        return writer
    }

    private init(
        handle: FileHandle,
        columnIDs: [String],
        metadata: [String: String]
    ) {
        self.handle = handle
        self.columnIDs = columnIDs
        // Stable order for repeatability across sessions.
        self.metadata = metadata.keys.sorted().map { ($0, metadata[$0] ?? "") }
    }

    private func writeHeader() throws {
        var header = "timestamp_utc,session_elapsed_ms"
        for (key, _) in metadata {
            header += "," + key
        }
        for col in columnIDs {
            header += "," + col
        }
        header += "\n"
        if let data = header.data(using: .utf8) {
            try handle.write(contentsOf: data)
        }
    }

    func writeRow(
        timestampISO: String,
        elapsedMs: Int,
        values: [String: String]
    ) throws {
        guard !closed else { return }
        // Skip rows where every PID is empty.
        let hasAny = columnIDs.contains { id in
            if let v = values[id], !v.isEmpty { return true } else { return false }
        }
        if !hasAny { return }

        var cells: [String] = [timestampISO, String(elapsedMs)]
        for (_, value) in metadata { cells.append(escape(value)) }
        for id in columnIDs {
            if let v = values[id] {
                cells.append(escape(v))
            } else {
                cells.append("")
            }
        }
        buffer += cells.joined(separator: ",") + "\n"
        rowCount += 1
        if Date().timeIntervalSince(lastFlush) > flushInterval {
            try flush()
        }
    }

    func flush() throws {
        guard !buffer.isEmpty else { return }
        let out = buffer
        buffer = ""
        if let data = out.data(using: .utf8) {
            try handle.write(contentsOf: data)
        }
        lastFlush = Date()
    }

    func close() throws {
        guard !closed else { return }
        closed = true
        try flush()
        try handle.close()
    }

    private func escape(_ s: String) -> String {
        if s.contains(",") || s.contains("\"") || s.contains("\n") {
            return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return s
    }
}
