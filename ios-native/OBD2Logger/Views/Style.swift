import SwiftUI

/// Centralized typography scale for the iOS app. Use these tokens instead
/// of inline `.font(.caption.monospaced())` etc. so the visual hierarchy
/// is one file's responsibility, not scattered across every view.
///
/// Hierarchy, largest to smallest:
///
///   appBrand     — `obd2/logger` header bar (title2 mono bold)
///   stepTitle    — onboarding step heading (title2 semibold)
///   cardTitle    — section labels: "Vehicles", "Connection", "Sessions"…
///   valueLabel   — primary content: vehicle display name, vehicle row title
///   valueNumber  — live readout numbers (callout mono semibold)
///   bodyText     — descriptions, hints (callout)
///   statusText   — error / status messages (footnote)
///   captionText  — small inline labels / counts (caption)
///   captionTiny  — even smaller inline labels (caption2)
///   monoSmall    — slugs, profile IDs, ACTIVE badge, timestamps
///   monoTiny     — micro metadata: cached-PID counts, log direction labels
///
/// When an existing call doesn't fit cleanly into one of these, prefer
/// adding a new token here over reintroducing inline font expressions.
extension Font {
    static let appBrand    = Font.system(.title2, design: .monospaced, weight: .bold)
    static let stepTitle   = Font.title2.weight(.semibold)
    static let cardTitle   = Font.subheadline.weight(.semibold)
    static let valueLabel  = Font.callout.weight(.semibold)
    static let valueNumber = Font.callout.monospaced().weight(.semibold)
    static let bodyText    = Font.callout
    static let statusText  = Font.footnote
    static let captionText = Font.caption
    static let captionTiny = Font.caption2
    static let monoSmall   = Font.caption.monospaced()
    static let monoTiny    = Font.caption2.monospaced()
}
