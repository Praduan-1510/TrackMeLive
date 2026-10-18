import Foundation

/// TMLCore: models, tokens and type shared by the Track Me Live app and its widget extension.
///
/// - `TMLColor`, `TMLSpacing`, `TMLRadius`, `TMLShadow`, `TMLType`: the design tokens, generated
///   from design-system/tokens.json into code/shared/tokens/generated/swift (symlinked as Tokens/).
/// - `DisplayStyle` and `.displayFont(_:)`: Gabarito for titles, numbers and badges, scaled with
///   `UIFontMetrics`. Body text stays in SF Pro.
/// - `ShareActivityAttributes`: the share session's Live Activity.
/// - `Mascot`, `DistanceText`: small value types both targets need.
public enum TMLCore {
    /// The App Group the app and the widget extension share (UserDefaults, pending routes).
    public static let appGroup = "group.live.trackme.app"
    /// The app's URL scheme, for deep links from the Live Activity and the control.
    public static let urlScheme = "trackmelive"
    /// The key in `sharedDefaults` where an intent leaves the route the app should open.
    public static let pendingRouteKey = "pendingRoute"

    /// Deep links the widget extension opens the app with.
    public enum Route: String, Sendable, CaseIterable {
        /// The share screen for the current call (the control, Share again).
        case share
        /// The live map of the running session (tapping the Live Activity, Open map).
        case live
        /// The Stop sharing confirmation (the Live Activity's Stop sharing opens the app to confirm).
        case stop

        public var url: URL { URL(string: "\(TMLCore.urlScheme)://\(rawValue)")! }

        public init?(url: URL) {
            guard url.scheme == TMLCore.urlScheme, let host = url.host(), let route = Route(rawValue: host) else { return nil }
            self = route
        }
    }

    /// UserDefaults shared with the widget extension, or the app's own when the App Group
    /// container isn't available (a build signed without entitlements, such as `run.sh`'s fallback).
    public static var sharedDefaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }
}
