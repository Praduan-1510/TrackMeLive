import Foundation
#if os(iOS)
import ActivityKit
#endif

/// The Live Activity for one share session (the FSD's "In-call mini map" on iOS): on the Lock
/// Screen and in the Dynamic Island while the sharer is out of the app.
///
/// The app starts it when a session starts and ends it when the session stops. Updates come from
/// the app while it runs in the background and from APNs (the session's `live_activity_token`,
/// kept in `shareSessions/{id}/private/meta`). Both the app and the widget extension link this
/// type, which ActivityKit needs: the same type on both sides.
///
/// The mascot is snapshotted when the session starts, like the session document's `sharer`:
/// a share keeps the mascot it started with.
public struct ShareActivityAttributes: Codable, Hashable, Sendable {
    /// `shareSessions/{sessionId}`.
    public var sessionID: String
    public var mascot: TMLMascotId
    public var mascotColor: TMLMascotColor
    public var mascotAccessory: TMLMascotAccessory?
    /// "Who it's for" (`private/meta.viewer_name`), only ever shown on the sharer's own screens.
    /// Nil means "they".
    public var viewerName: String?
    public var startedAt: Date
    /// The hard 1-hour limit.
    public var expiresAt: Date

    public init(sessionID: String, mascot: TMLMascotId, mascotColor: TMLMascotColor = .original,
                mascotAccessory: TMLMascotAccessory? = nil, viewerName: String?, startedAt: Date, expiresAt: Date) {
        self.sessionID = sessionID
        self.mascot = mascot
        self.mascotColor = mascotColor
        self.mascotAccessory = mascotAccessory
        self.viewerName = viewerName
        self.startedAt = startedAt
        self.expiresAt = expiresAt
    }

    /// The attributes for a session document, with the name the sharer gave the link.
    public init(sessionID: String, session: TMLShareSession, viewerName: String?) {
        self.init(sessionID: sessionID, mascot: session.sharer.mascotId, mascotColor: session.sharer.mascotColor,
                  mascotAccessory: session.sharer.mascotAccessory, viewerName: viewerName,
                  startedAt: session.startedAt, expiresAt: session.expiresAt)
    }

    /// What changes during the session.
    public struct ContentState: Codable, Hashable, Sendable {
        public enum Signal: String, Codable, Sendable {
            /// Pings are going out.
            case live
            /// No fix better than 100 m for 30 s: "No signal" with a last-seen time.
            case noSignal
            /// The phone can't send: "No connection" with a last-seen time.
            case noConnection
        }

        public var signal: Signal
        /// When the sharer's newest ping was recorded (for "Last seen 9:41 pm").
        public var lastPingAt: Date
        /// `first_viewed_at`: nil until the viewer opens the link.
        public var viewerOpenedAt: Date?
        /// `viewer_sharing`: Live Together.
        public var viewerSharing: Bool
        /// Straight-line distance to the viewer, worked out on the phone from their newest
        /// share-back ping. Nil until they share back.
        public var distanceMeters: Double?
        /// Approximate location: distances read "about 1 km".
        public var approximate: Bool
        /// `stop_at`: when a timer (or the limit rule) stops sharing. Nil while the stop rule is the call.
        public var stopsAt: Date?

        public init(signal: Signal = .live, lastPingAt: Date, viewerOpenedAt: Date? = nil,
                    viewerSharing: Bool = false, distanceMeters: Double? = nil, approximate: Bool = false,
                    stopsAt: Date? = nil) {
            self.signal = signal
            self.lastPingAt = lastPingAt
            self.viewerOpenedAt = viewerOpenedAt
            self.viewerSharing = viewerSharing
            self.distanceMeters = distanceMeters
            self.approximate = approximate
            self.stopsAt = stopsAt
        }
    }
}

public extension ShareActivityAttributes {
    /// Five minutes before the 1-hour limit, a quiet line says when sharing stops.
    static var limitWarningLead: TimeInterval { TimeInterval(TMLSchemaConstants.expiryWarningMinutes * 60) }

    /// The name the sharer gave, trimmed, or nil.
    var viewerDisplayName: String? {
        let trimmed = viewerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    /// "Sharing with Mom", or "Sharing your location" without a name. Never a guessed pronoun.
    var sharingWithLine: String {
        viewerDisplayName.map { "Sharing with \($0)" } ?? "Sharing your location"
    }

    /// The viewer's status before they share back: "Link sent · not opened yet", then
    /// "Mom is watching" ("They're watching" without a name).
    func viewerStatusLine(_ state: ContentState) -> String {
        guard state.viewerOpenedAt != nil else { return "Link sent · not opened yet" }
        return viewerDisplayName.map { "\($0) is watching" } ?? "They\u{2019}re watching"
    }

    /// Whether the 1-hour warning shows at `date`.
    func showsLimitWarning(at date: Date) -> Bool {
        date >= expiresAt.addingTimeInterval(-Self.limitWarningLead) && date < expiresAt
    }

    /// When sharing really stops: the earlier of the timer and the 1-hour limit, or nil while it
    /// stops with the call (the limit still applies; the warning line covers it).
    func stopsAt(_ state: ContentState) -> Date? {
        state.stopsAt.map { min($0, expiresAt) }
    }
}

#if os(iOS)
extension ShareActivityAttributes: ActivityAttributes {}
#endif
