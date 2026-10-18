#if canImport(CoreLocation)
import CoreLocation
import Foundation
import Observation
#if canImport(UIKit)
import UIKit
#endif

/// Core Location's live updates (`CLLocationUpdate.liveUpdates`), for the share.
///
/// Each stream holds, for exactly its own life:
/// - a `CLServiceSession` asking for While Using, which keeps the app's authorization in force while
///   it shares (iOS 18 service sessions);
/// - with `background`, a `CLBackgroundActivitySession`, which lets a While Using app keep getting
///   updates in the background, with the system's location indicator showing (FSD §8 Background
///   sharing; Info.plist's `location` background mode). It must start in the foreground.
/// Ending the stream invalidates both, so location stops, in the background too, when sharing does.
@MainActor
public final class LiveLocationStream: LocationStream {
    public init() {}

    public func updates(background: Bool) -> AsyncStream<LocationUpdate> {
        AsyncStream(bufferingPolicy: .bufferingNewest(8)) { continuation in
            #if os(iOS)
            let service = CLServiceSession(authorization: .whenInUse)
            let activity = background ? CLBackgroundActivitySession() : nil
            #endif
            let task = Task {
                while !Task.isCancelled {
                    do {
                        // Pedestrian and general navigation: continuous, best accuracy, any mode of travel.
                        for try await update in CLLocationUpdate.liveUpdates(.otherNavigation) {
                            continuation.yield(LocationUpdate(update))
                        }
                    } catch {
                        // The updates failed (rare); start them again in a moment.
                    }
                    try? await Task.sleep(for: .seconds(2))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in
                task.cancel()
                #if os(iOS)
                activity?.invalidate()
                service.invalidate()
                #endif
            }
        }
    }
}

extension LocationUpdate {
    /// From Core Location, with its diagnostics.
    public init(_ update: CLLocationUpdate) {
        let problem: LocationProblem? =
            if update.authorizationDeniedGlobally { .servicesOff }
            else if update.authorizationRestricted { .restricted }
            else if update.authorizationDenied { .denied }
            else if update.insufficientlyInUse { .notInUse }
            else if update.locationUnavailable { .unavailable }
            else { nil }
        self.init(fix: update.location.map(LocationFix.init), isStationary: update.stationary,
                  isAccuracyLimited: update.accuracyLimited, problem: problem)
    }
}

extension LocationFix {
    public init(_ location: CLLocation) {
        self.init(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                  horizontalAccuracy: location.horizontalAccuracy, timestamp: location.timestamp,
                  speed: location.speed >= 0 ? location.speed : nil)
    }
}

extension LocationAuthorization.Status {
    public init(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notDetermined
        case .authorizedWhenInUse: self = .whenInUse
        case .authorizedAlways: self = .always
        case .restricted: self = .restricted
        case .denied: self = .denied
        @unknown default: self = .denied
        }
    }
}

/// The real location access: `CLLocationManager`. Make it on the main actor, once.
///
/// It shares the "has asked" flag with `LivePermissionsService` (the same defaults key), so
/// Settings and the share flow agree on Not set and Ask next time.
@MainActor
@Observable
public final class LiveLocationAccess: LocationAccess {
    /// Info.plist's `NSLocationTemporaryUsageDescriptionDictionary` key for the one-time precise request.
    public static let precisePurposeKey = "SharePrecise"
    static let askedKey = "permissions.location.asked"

    public private(set) var authorization: LocationAuthorization

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private let delegate = AuthorizationDelegate()
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var servicesEnabled = true
    @ObservationIgnored private var waiting: [CheckedContinuation<Void, Never>] = []

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        authorization = .notAsked
        delegate.onChange = { [weak self] in self?.authorizationChanged() }
        manager.delegate = delegate
        read()
        Task { await refresh() }
    }

    public func refresh() async {
        // Apple warns this can block, so it's asked off the main actor.
        servicesEnabled = await Task.detached { CLLocationManager.locationServicesEnabled() }.value
        read()
    }

    public func requestWhenInUse() async -> LocationAuthorization {
        // iOS shows the prompt only while it's undetermined; the delegate reports the answer.
        guard manager.authorizationStatus == .notDetermined, servicesEnabled else { return authorization }
        defaults.set(true, forKey: Self.askedKey)
        await withCheckedContinuation { continuation in
            waiting.append(continuation)
            manager.requestWhenInUseAuthorization()
        }
        return authorization
    }

    public func requestPreciseOnce() async -> LocationAuthorization {
        guard authorization.isAllowed, !authorization.precise else { return authorization }
        // Throws when the key is missing from Info.plist or the request can't be shown; either way
        // the share stays Approximate.
        _ = try? await manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: Self.precisePurposeKey)
        read()
        return authorization
    }

    public var settingsURL: URL? {
        #if canImport(UIKit)
        URL(string: UIApplication.openSettingsURLString)
        #else
        nil
        #endif
    }

    private func read() {
        authorization = LocationAuthorization(status: LocationAuthorization.Status(manager.authorizationStatus),
                                              precise: manager.accuracyAuthorization == .fullAccuracy,
                                              hasAsked: defaults.bool(forKey: Self.askedKey),
                                              servicesEnabled: servicesEnabled)
    }

    private func authorizationChanged() {
        read()
        // The first callback comes when the manager is made, before any answer.
        guard manager.authorizationStatus != .notDetermined else { return }
        let resumed = waiting
        waiting = []
        for continuation in resumed { continuation.resume() }
    }
}

/// Forwards authorization changes to the main actor. The manager calls it on the thread it was
/// made on, which is the main thread here.
@MainActor
private final class AuthorizationDelegate: NSObject, CLLocationManagerDelegate {
    var onChange: (@MainActor () -> Void)?

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in self?.onChange?() }
    }
}
#endif
