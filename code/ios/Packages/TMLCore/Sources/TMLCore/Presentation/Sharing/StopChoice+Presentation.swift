import Foundation

/// The share screen's and the timer sheet's view of `StopChoice` (Services/Sharing): which choices
/// are on offer and what each one sets (FSD §4 Stop rule; prototype `stopOptions`, `stopLabel`).
///
/// - Before sharing: When the call ends (only during a call), In 15 min, In 30 min, In 1 hour.
/// - While sharing: When the call ends (only while the session's own call is connected), the timers
///   that would still end before the 1-hour limit, and At the 1-hour limit.
///
/// Every session also stops at `expires_at`, one hour after it starts, whatever the choice.
extension StopChoice: Identifiable {
    public var id: String {
        switch self {
        case .call: "call"
        case .minutes(let minutes): "minutes-\(minutes.rawValue)"
        case .limit: "limit"
        }
    }

    /// The choice a share starts with, from Settings › Default stop time. The call is the default
    /// only during a call; without one, a call default becomes 30 minutes (FSD §4 Stop rule).
    public init(defaultStop: TMLDefaultStop, onCall: Bool) {
        switch defaultStop {
        case .call: self = onCall ? .call : .minutes(.minutes30)
        case .minutes15: self = .minutes(.minutes15)
        case .minutes30: self = .minutes(.minutes30)
        case .minutes60: self = .minutes(.minutes60)
        }
    }

    /// The words on the Stops row and in the timer sheet: "When the call ends", "In 15 min",
    /// "In 1 hour", "At the 1-hour limit · 10:38 pm".
    public func label(expiresAt: Date?, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        if self == .limit, expiresAt == nil { return "At the 1-hour limit" }
        return label(limitTime: expiresAt.map { TimeText.clock($0, locale: locale, timeZone: timeZone) } ?? "")
    }

    /// The choices on the share screen, before the session exists.
    public static func beforeSharing(onCall: Bool) -> [StopChoice] {
        (onCall ? [.call] : []) + TMLStopMinutes.allCases.map(StopChoice.minutes)
    }
}
