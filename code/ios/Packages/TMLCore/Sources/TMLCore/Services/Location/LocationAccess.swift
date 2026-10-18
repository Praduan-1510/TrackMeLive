import Foundation

/// The app's location authorization, in full: what Core Location says, plus whether the app has
/// asked before (which tells Not set from Ask next time) and whether Location Services is on.
///
/// The FSD's path is not determined → While Using, and no further: "While using the app" is all
/// sharing needs, because it always starts in the app and continues in the background with a
/// background activity session (FSD §8). The app never asks for Always. `.always` exists only
/// because the person can choose it in Settings, and it works the same as While Using.
public struct LocationAuthorization: Hashable, Sendable {
    public enum Status: Hashable, Sendable {
        case notDetermined
        case whenInUse
        case always
        case denied
        /// Screen Time or a device profile: the person can't turn it on.
        case restricted
    }

    public var status: Status
    /// Precise Location is on for the app (full accuracy, possibly just for this share).
    public var precise: Bool
    /// The app has shown the system prompt before.
    public var hasAsked: Bool
    /// Location Services is on for the whole phone.
    public var servicesEnabled: Bool

    public init(status: Status, precise: Bool = true, hasAsked: Bool = false, servicesEnabled: Bool = true) {
        self.status = status
        self.precise = precise
        self.hasAsked = hasAsked
        self.servicesEnabled = servicesEnabled
    }

    public static let notAsked = LocationAuthorization(status: .notDetermined)

    /// What Settings › Permissions shows.
    public var permission: LocationPermission {
        guard servicesEnabled else { return .off }
        switch status {
        case .notDetermined: return hasAsked ? .askNextTime : .notSet
        case .whenInUse: return .whileUsing(precise: precise)
        case .always: return .always(precise: precise)
        case .denied, .restricted: return .off
        }
    }

    /// Whether a share can start now without a prompt.
    public var isAllowed: Bool { servicesEnabled && (status == .whenInUse || status == .always) }

    /// What tapping Share live location must do about location first (FSD §8), for a share that
    /// wants `precision`.
    public func gate(wanting precision: TMLPrecision) -> LocationGate {
        if status == .restricted { return .restricted }
        guard servicesEnabled else { return .turnOnInSettings(servicesOff: true) }
        switch status {
        case .notDetermined:
            return hasAsked ? .ask : .explain
        case .denied:
            return .turnOnInSettings(servicesOff: false)
        case .restricted:
            return .restricted
        case .whenInUse, .always:
            // With Precise Location off for the app, shares are Approximate, and the share screen
            // offers the system's one-time precise request (FSD §8).
            return precise
                ? .ready(precision: precision, offerPrecise: false)
                : .ready(precision: .approximate, offerPrecise: precision == .precise)
        }
    }
}

/// The share flow's next step for location (FSD §8): "requested on the first share attempt, never
/// at install, with an in-app explanation before the system prompt".
public enum LocationGate: Hashable, Sendable {
    /// Never asked: show the in-app explainer, then the system prompt (`requestWhenInUse`).
    case explain
    /// Asked before and iOS will ask again (Allow Once ended, or Ask Next Time): the system prompt.
    case ask
    /// Off for the app (or Location Services is off for the phone): explain how to turn it on, and
    /// offer `settingsURL`.
    case turnOnInSettings(servicesOff: Bool)
    /// Blocked by Screen Time or a profile; Settings can't change it, so there's no button.
    case restricted
    /// Sharing can start, at `precision` (Approximate when Precise Location is off for the app).
    /// `offerPrecise`: the person wanted Precise, so the share screen offers the one-time request.
    case ready(precision: TMLPrecision, offerPrecise: Bool)
}

/// Reads and asks for location access for sharing. One per app; the composition root makes
/// `LiveLocationAccess`, previews and tests use `FakeLocationAccess`.
@MainActor
public protocol LocationAccess: AnyObject {
    /// The current authorization. Implementations are `@Observable`, so screens follow it.
    var authorization: LocationAuthorization { get }
    /// Reads it again (when the app comes back from Settings).
    func refresh() async
    /// The system's While Using prompt, when iOS will still show it. Returns the answer.
    func requestWhenInUse() async -> LocationAuthorization
    /// The system's one-time precise request (temporary full accuracy, for this share only), when
    /// Precise Location is off for the app. Returns the answer.
    func requestPreciseOnce() async -> LocationAuthorization
    /// The app's page in Settings, where location can be turned back on.
    var settingsURL: URL? { get }
}
