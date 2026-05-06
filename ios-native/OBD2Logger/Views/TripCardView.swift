import SwiftUI

/// Live trip stats while the adapter is connected — current ground speed
/// and accumulated distance since the most recent session start. Sourced
/// from `LocationKeepAlive`'s persistent CoreLocation updates.
///
/// The card is the user-facing feature that justifies the `location`
/// background mode in `Info.plist`: speed and distance both *benefit
/// from persistent location updates*, which is the bar guideline 2.5.4
/// requires. The data is displayed only — no GPS values are written to
/// the CSV or sent off the device.
struct TripCardView: View {
    var location = LocationKeepAlive.shared
    var ble = BLEManager.shared

    var body: some View {
        if shouldShow {
            VStack(alignment: .leading, spacing: 8) {
                Text("Trip")
                    .font(.cardTitle)
                HStack(alignment: .firstTextBaseline) {
                    statRow(label: "Speed", value: speedDisplay)
                    Spacer()
                    statRow(label: "Distance", value: distanceDisplay)
                }
                Text("Live GPS — used to track speed and distance during your session. Not stored or shared.")
                    .font(.statusText)
                    .foregroundStyle(.tertiary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    /// Show the card while the adapter is connected (real or demo). That's
    /// when a session can be active, and when location updates are running.
    private var shouldShow: Bool {
        if case .connected = ble.connectionState { return true }
        return false
    }

    private func statRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.captionText)
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.valueNumber)
                .foregroundStyle(.primary)
        }
    }

    private var speedDisplay: String {
        guard let mps = location.currentSpeedMps else { return "—" }
        let measurement = Measurement(value: mps, unit: UnitSpeed.metersPerSecond)
        return measurement.formatted(
            .measurement(width: .abbreviated, usage: .asProvided)
                .locale(.current)
        )
    }

    private var distanceDisplay: String {
        let measurement = Measurement(value: location.tripDistanceMeters, unit: UnitLength.meters)
        // .road usage auto-picks miles in US-locale, kilometres elsewhere,
        // and snaps to a sensible precision.
        return measurement.formatted(
            .measurement(width: .abbreviated, usage: .road)
                .locale(.current)
        )
    }
}
