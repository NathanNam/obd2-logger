import Foundation
import Observation

/// Wraps `FileManager` operations against the app's `Documents` directory.
/// All paths are relative to that root. Files written here are visible from
/// the iOS Files app under "On My iPhone → OBD2 Logger" (gated by the
/// `LSSupportsOpeningDocumentsInPlace` and `UIFileSharingEnabled` keys in
/// Info.plist).
final class AppStorage {

    static let shared = AppStorage()

    private let fm = FileManager.default
    private let root: URL

    init() {
        // Documents directory always exists for an iOS app.
        root = fm.urls(for: .documentDirectory, in: .userDomainMask).first!
    }

    /// Resolve a path relative to the app's Documents root.
    func url(for relative: String) -> URL {
        root.appendingPathComponent(relative)
    }

    /// Idempotently create a directory (and its parents).
    func ensureDir(_ relative: String) throws {
        let url = url(for: relative)
        if !fm.fileExists(atPath: url.path) {
            try fm.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }

    func exists(_ relative: String) -> Bool {
        fm.fileExists(atPath: url(for: relative).path)
    }

    func writeText(_ text: String, to relative: String) throws {
        let url = url(for: relative)
        try ensureParent(of: url)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    func readText(_ relative: String) throws -> String {
        try String(contentsOf: url(for: relative), encoding: .utf8)
    }

    func appendText(_ text: String, to relative: String) throws {
        let url = url(for: relative)
        try ensureParent(of: url)
        if fm.fileExists(atPath: url.path) {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            if let data = text.data(using: .utf8) {
                try handle.write(contentsOf: data)
            }
        } else {
            try text.write(to: url, atomically: true, encoding: .utf8)
        }
    }

    func writeJSON<T: Encodable>(_ value: T, to relative: String) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        let data = try encoder.encode(value)
        let url = url(for: relative)
        try ensureParent(of: url)
        try data.write(to: url, options: .atomic)
    }

    func readJSON<T: Decodable>(_ type: T.Type, from relative: String) throws -> T {
        let data = try Data(contentsOf: url(for: relative))
        return try JSONDecoder().decode(type, from: data)
    }

    func listDir(_ relative: String) throws -> [URL] {
        let url = url(for: relative)
        guard fm.fileExists(atPath: url.path) else { return [] }
        return try fm.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)
    }

    func remove(_ relative: String) throws {
        let url = url(for: relative)
        if fm.fileExists(atPath: url.path) {
            try fm.removeItem(at: url)
        }
    }

    private func ensureParent(of url: URL) throws {
        let parent = url.deletingLastPathComponent()
        if !fm.fileExists(atPath: parent.path) {
            try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        }
    }
}

// MARK: - Path helpers

enum AppPath {
    static func ownerDir(_ owner: String) -> String { "data/\(owner)" }
    static func vehicleDir(_ owner: String, _ slug: String) -> String { "data/\(owner)/\(slug)" }
    static func vehicleJSON(_ owner: String, _ slug: String) -> String { "data/\(owner)/\(slug)/vehicle.json" }
    static func sessionsDir(_ owner: String, _ slug: String) -> String { "data/\(owner)/\(slug)/sessions" }
    static func sessionsManifest(_ owner: String, _ slug: String) -> String { "data/\(owner)/\(slug)/sessions.jsonl" }
}
