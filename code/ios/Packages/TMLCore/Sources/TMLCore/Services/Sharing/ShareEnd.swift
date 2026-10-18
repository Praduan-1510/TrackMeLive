import Foundation

/// Why a share ended, as the ended screen tells it (prototype `viewEnded`, `endedWhy`). The server's
/// `end_reason` decides it; until the server has recorded a local end (Stop, or the timer or the
/// limit passing by the server's clock), the app shows what it expects.
public enum ShareEndReason: Hashable, Sendable {
    /// The sharer tapped Stop.
    case stopped
    /// The call ended and the stop rule was the call.
    case call
    /// `stop_at` passed.
    case timer
    /// The 1-hour `expires_at` passed (also when `stop_at` was `expires_at`).
    case limit

    public init(_ reason: TMLEndReason) {
        switch reason {
        case .stopped: self = .stopped
        case .call: self = .call
        case .timer: self = .timer
        case .limit: self = .limit
        }
    }

    /// The wire value.
    public var endReason: TMLEndReason {
        switch self {
        case .stopped: .stopped
        case .call: .call
        case .timer: .timer
        case .limit: .limit
        }
    }

    /// The ended screen's heading.
    public var title: String {
        self == .limit ? "Sharing stopped after 1 hour" : "Sharing ended"
    }

    /// The line under it. `endedTime` is the formatted `ended_at` ("9:52 pm").
    public func message(endedTime: String) -> String {
        switch self {
        case .limit: "That\u{2019}s the longest a link can run. Share again to send a new link."
        case .call: "Your call ended, so sharing stopped."
        case .timer: "Your timer ran out, so sharing stopped."
        case .stopped: "You stopped sharing at \(endedTime)."
        }
    }

    /// Only the limit offers Share again (a new link); the others offer Done.
    public var offersShareAgain: Bool { self == .limit }
}

/// A share that has ended: what the ended screen shows.
public struct EndedShare: Hashable, Sendable {
    public var sessionId: String
    public var reason: ShareEndReason
    public var startedAt: Date
    /// When it ended, by the server's clock: for a timer or the limit, when it was due.
    public var endedAt: Date
    /// Who it's for, when a name was given.
    public var viewerName: String?
    /// When the link was first opened; nil if never.
    public var firstViewedAt: Date?
    /// Whether the viewer shared back at any point.
    public var sharedBack: Bool
    /// The server has recorded the end. False for a moment after Stop or a local expiry, and for
    /// as long as Stop can't reach the server (the app keeps trying).
    public var confirmed: Bool

    public init(sessionId: String, reason: ShareEndReason, startedAt: Date, endedAt: Date, viewerName: String? = nil,
                firstViewedAt: Date? = nil, sharedBack: Bool = false, confirmed: Bool) {
        self.sessionId = sessionId
        self.reason = reason
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.viewerName = viewerName
        self.firstViewedAt = firstViewedAt
        self.sharedBack = sharedBack
        self.confirmed = confirmed
    }

    /// How long it ran (the summary's Shared for).
    public var duration: TimeInterval { max(0, endedAt.timeIntervalSince(startedAt)) }

    /// When the session's location points are deleted: 24 hours after it ended (FSD §8 Retention).
    public var pointsDeletedBy: Date {
        endedAt.addingTimeInterval(TimeInterval(TMLSchemaConstants.pingRetentionHours * 3600))
    }
}
