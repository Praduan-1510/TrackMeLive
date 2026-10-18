import Foundation
import Observation
#if canImport(CoreLocation)
import CoreLocation
#endif
#if canImport(UserNotifications)
import UserNotifications
#endif

/// Location access as Settings shows it.
///
/// iOS reports "not determined" both before the app ever asked and after a one-time allow ends or
/// the person picks Ask Next Time, so the service remembers whether it has asked to tell the two
/// apart. The app only ever asks for While Using; Always appears only if someone sets it in Settings.
public enum LocationPermission: Hashable, Sendable {
    /// Never asked.
    case notSet
    /// Asked before, and iOS will ask again: Allow Once ended, or Ask Next Time in Settings.
    case askNextTime
    case whileUsing(precise: Bool)
    case always(precise: Bool)
    /// Denied, or restricted on this iPhone.
    case off

    #if canImport(CoreLocation)
    public init(status: CLAuthorizationStatus, accuracy: CLAccuracyAuthorization, hasAsked: Bool) {
        let precise = accuracy == .fullAccuracy
        switch status {
        case .notDetermined: self = hasAsked ? .askNextTime : .notSet
        case .authorizedWhenInUse: self = .whileUsing(precise: precise)
        case .authorizedAlways: self = .always(precise: precise)
        case .denied, .restricted: self = .off
        @unknown default: self = .off
        }
    }
    #endif

    /// Whether sharing can start without asking first.
    public var isAllowed: Bool {
        switch self {
        case .whileUsing, .always: true
        case .notSet, .askNextTime, .off: false
        }
    }

    /// Whether the app gets the exact spot (false when Precise Location is off for it), or nil
    /// while it has no access.
    public var preciseLocation: Bool? {
        switch self {
        case .whileUsing(let precise), .always(let precise): precise
        case .notSet, .askNextTime, .off: nil
        }
    }
}

/// Notification access as Settings shows it. Provisional and ephemeral count as allowed.
public enum NotificationPermission: Hashable, Sendable {
    case notSet
    case allowed
    case off

    #if canImport(UserNotifications)
    public init(status: UNAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notSet
        case .authorized, .provisional, .ephemeral: self = .allowed
        case .denied: self = .off
        @unknown default: self = .off
        }
    }
    #endif
}

/// One Permissions row in Settings: the words, and what tapping it does.
public struct PermissionRow: Hashable, Sendable {
    public enum Action: Hashable, Sendable {
        /// Show the in-app explainer first, then the system prompt.
        case explain
        /// Go straight to the system prompt: the person has already seen the explainer.
        case ask
        /// The system won't ask again; offer to open Settings.
        case openSettings
    }

    public let title: String
    /// The state in sentence case: "While using the app", "Not set", "Off".
    public let value: String
    /// A second line: "Precise: On".
    public let detail: String?
    /// Nil when there's nothing to do, so the row isn't a button.
    public let action: Action?

    /// What VoiceOver says the row does.
    public var hint: String? {
        switch action {
        case .explain, .ask: "Asks for permission."
        case .openSettings: "Explains how to turn it on in Settings."
        case nil: nil
        }
    }

    public init(_ permission: LocationPermission) {
        title = "Location"
        switch permission {
        case .notSet:
            value = "Not set"; detail = nil; action = .explain
        case .askNextTime:
            value = "Ask next time"; detail = nil; action = .ask
        case .whileUsing(let precise):
            value = "While using the app"; detail = Self.preciseLine(precise); action = nil
        case .always(let precise):
            value = "Always"; detail = Self.preciseLine(precise); action = nil
        case .off:
            value = "Off"; detail = nil; action = .openSettings
        }
    }

    public init(_ permission: NotificationPermission) {
        title = "Notifications"
        detail = nil
        switch permission {
        case .notSet: value = "Not set"; action = .explain
        case .allowed: value = "Allowed"; action = nil
        case .off: value = "Off"; action = .openSettings
        }
    }

    private static func preciseLine(_ precise: Bool) -> String { precise ? "Precise: On" : "Precise: Off" }
}

/// The explainers and alerts the permission rows open, in the app's voice (prototype `permPrompt`).
public enum PermissionPrompt: String, Hashable, Sendable, Identifiable {
    case locationExplainer, notificationsExplainer, locationOff, notificationsOff

    public var id: String { rawValue }

    /// An explainer is a sheet with a picture; the others are alerts.
    public var isExplainer: Bool { self == .locationExplainer || self == .notificationsExplainer }

    /// The SF Symbol on an explainer.
    public var systemImage: String {
        switch self {
        case .locationExplainer, .locationOff: "location.fill"
        case .notificationsExplainer, .notificationsOff: "bell.fill"
        }
    }

    public var title: String {
        switch self {
        case .locationExplainer: "Allow location to share"
        case .notificationsExplainer: "Know when your link is opened"
        case .locationOff: "Location is off for Track Me Live"
        case .notificationsOff: "Notifications are off"
        }
    }

    public var message: String {
        switch self {
        case .locationExplainer:
            "Track Me Live uses your location only while you\u{2019}re sharing. "
                + "Nobody sees it until you send your link, and it stops when you do."
        case .notificationsExplainer:
            "Turn on alerts to hear when your link is opened, when a call ends while you\u{2019}re sharing, and when sharing stops."
        case .locationOff:
            "To share where you are, turn on location in Settings. It\u{2019}s only used while you share."
        case .notificationsOff:
            "To hear when your link is opened and when sharing stops, turn on notifications for Track Me Live in Settings."
        }
    }

    /// The prominent action.
    public var confirmTitle: String {
        switch self {
        case .locationExplainer: "Continue"
        case .notificationsExplainer: "Turn on alerts"
        case .locationOff, .notificationsOff: "Open Settings"
        }
    }

    public var cancelTitle: String { "Not now" }
}

/// Reads and asks for location and notification access. The app's composition root makes one
/// `LivePermissionsService`; previews and tests use `FixedPermissionsService`.
@MainActor
public protocol PermissionsService: AnyObject {
    var location: LocationPermission { get }
    var notifications: NotificationPermission { get }
    /// Reads both again (on appear, and when the app comes back from Settings).
    func refresh() async
    /// Shows the system's location prompt (While Using). The state updates when the person answers.
    func requestLocation() async
    /// Shows the system's notification prompt and waits for the answer.
    func requestNotifications() async
}

/// A permissions service with states you set: previews, tests, and the screens' fixed states.
/// Asking moves Not set or Ask next time to allowed, as if the person said yes.
@MainActor
@Observable
public final class FixedPermissionsService: PermissionsService {
    public var location: LocationPermission
    public var notifications: NotificationPermission
    public private(set) var requests: [String] = []

    public init(location: LocationPermission = .notSet, notifications: NotificationPermission = .notSet) {
        self.location = location
        self.notifications = notifications
    }

    public func refresh() async {}

    public func requestLocation() async {
        requests.append("location")
        if location == .notSet || location == .askNextTime { location = .whileUsing(precise: true) }
    }

    public func requestNotifications() async {
        requests.append("notifications")
        if notifications == .notSet { notifications = .allowed }
    }
}

#if canImport(CoreLocation) && canImport(UserNotifications)
/// The real permissions: `CLLocationManager` and `UNUserNotificationCenter`.
///
/// Make it on the main actor in the app's process only (`UNUserNotificationCenter` needs an app
/// bundle). It remembers in `defaults` whether it has asked for location, which is what tells
/// Not set apart from Ask next time.
@MainActor
@Observable
public final class LivePermissionsService: PermissionsService {
    public private(set) var location: LocationPermission = .notSet
    public private(set) var notifications: NotificationPermission = .notSet

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private let delegate = LocationDelegate()
    @ObservationIgnored private let defaults: UserDefaults
    private static let askedKey = "permissions.location.asked"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        delegate.onChange = { [weak self] in self?.readLocation() }
        manager.delegate = delegate
        readLocation()
    }

    public func refresh() async {
        readLocation()
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notifications = NotificationPermission(status: settings.authorizationStatus)
    }

    public func requestLocation() async {
        // iOS ignores the request unless it's undetermined; the delegate reports the answer.
        guard manager.authorizationStatus == .notDetermined else { return }
        defaults.set(true, forKey: Self.askedKey)
        manager.requestWhenInUseAuthorization()
    }

    public func requestNotifications() async {
        // Alerts: link opened, a call ended while sharing, sharing expired. No badges.
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        await refresh()
    }

    private func readLocation() {
        location = LocationPermission(status: manager.authorizationStatus,
                                      accuracy: manager.accuracyAuthorization,
                                      hasAsked: defaults.bool(forKey: Self.askedKey))
    }
}

/// Forwards authorization changes to the main actor. The manager calls it on the thread it was
/// made on, which is the main thread here.
@MainActor
private final class LocationDelegate: NSObject, CLLocationManagerDelegate {
    var onChange: (@MainActor () -> Void)?

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in self?.onChange?() }
    }
}
#endif
