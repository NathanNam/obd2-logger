import CoreLocation
import Foundation
import Observation

/// Holds a `CLLocationManager` while a logging session is active, so iOS
/// won't suspend the app when it goes to background. This is Apple's
/// sanctioned keep-alive for trip-tracking apps (Strava, Waze, etc.) — the
/// `location` background mode + an active `startUpdatingLocation` keeps
/// the whole app running, including our BLE polling loop, without the
/// silent-audio hack we used previously.
///
/// We surface the latest fix (`lastLocation`) so the UI can show it and
/// future versions can write `lat` / `lon` / `gps_speed` / `heading`
/// columns into the CSV. Honest use of the location data (display +
/// optional logging) is what makes the background entitlement defensible
/// at App Review.
@MainActor
@Observable
final class LocationKeepAlive: NSObject, CLLocationManagerDelegate {

    static let shared = LocationKeepAlive()

    private let manager = CLLocationManager()
    private(set) var isActive = false
    private(set) var authorizationStatus: CLAuthorizationStatus = .notDetermined
    private(set) var lastLocation: CLLocation?
    private(set) var lastError: String?

    /// Cumulative distance (meters) since the most recent `start()`. Surfaced
    /// in `TripCardView` so the user sees how far they've driven during a
    /// session. Resets at every new session.
    private(set) var tripDistanceMeters: Double = 0
    /// Most recent ground speed (meters/second) reported by the GPS. nil if
    /// no fix yet, or if iOS reports negative speed (= speed unavailable).
    private(set) var currentSpeedMps: Double?

    private var previousLocation: CLLocation?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5  // meters; we don't need every micro-jitter
        manager.allowsBackgroundLocationUpdates = true
        // Don't auto-pause when the OS thinks we're stationary — for OBD2
        // logging we still want to keep the app alive even at red lights.
        manager.pausesLocationUpdatesAutomatically = false
        // Show the system's blue/green status-bar indicator while in
        // background so the user always knows location is being used.
        manager.showsBackgroundLocationIndicator = true
        authorizationStatus = manager.authorizationStatus
    }

    /// Call when a logging session starts. Requests "Always" authorization
    /// if needed; falls back to "When in use" silently if the user denies.
    /// Either case begins location updates so the app stays alive.
    func start() {
        guard !isActive else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            // Promote to "Always" so background stays alive when the user
            // locks the phone or switches to Maps. iOS will show a
            // one-time prompt the next time the app goes to background.
            manager.requestAlwaysAuthorization()
        default:
            break
        }
        // Reset trip stats so each session starts at zero.
        tripDistanceMeters = 0
        previousLocation = nil
        currentSpeedMps = nil
        manager.startUpdatingLocation()
        isActive = true
    }

    func stop() {
        guard isActive else { return }
        manager.stopUpdatingLocation()
        isActive = false
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        Task { @MainActor in
            // Accumulate trip distance from the previous fix to this one.
            // Only count fixes with reasonable accuracy and a non-trivial
            // delta, so GPS jitter at red lights doesn't fake a moving
            // vehicle.
            if let prev = self.previousLocation {
                let delta = latest.distance(from: prev)
                let goodAccuracy = latest.horizontalAccuracy >= 0 && latest.horizontalAccuracy < 30
                let realMovement = delta > 5
                if goodAccuracy && realMovement {
                    self.tripDistanceMeters += delta
                }
            }
            self.previousLocation = latest
            self.lastLocation = latest
            // CLLocation.speed is < 0 when the OS can't determine speed.
            self.currentSpeedMps = latest.speed >= 0 ? latest.speed : nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.lastError = error.localizedDescription
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorizationStatus = status
            if self.isActive && (status == .authorizedAlways || status == .authorizedWhenInUse) {
                manager.startUpdatingLocation()
            }
        }
    }
}
