import Foundation

/// The server's clock as the phone estimates it. The phone's own clock can be minutes off, and the
/// server decides when a session is over (Firestore rules compare with `request.time`), so every
/// deadline the app acts on (the countdown, the local end, a ping's `recorded_at`) runs on this.
///
/// The offset comes from `createSession`: the server stamps `started_at` while the call is in
/// flight, so the server's time is taken as `started_at` at the call's midpoint. The error is at
/// most half the round trip.
public struct ServerClock: Hashable, Sendable {
    /// Server time minus device time, in seconds.
    public var offset: TimeInterval

    public init(offset: TimeInterval = 0) {
        self.offset = offset
    }

    /// From a call sent at `sent` and answered at `received` (device times) that the server
    /// stamped `serverTime`.
    public init(serverTime: Date, sent: Date, received: Date) {
        let midpoint = sent.addingTimeInterval(received.timeIntervalSince(sent) / 2)
        offset = serverTime.timeIntervalSince(midpoint)
    }

    /// A device time on the server's clock.
    public func server(_ deviceTime: Date) -> Date { deviceTime.addingTimeInterval(offset) }

    /// A server time on the device's clock (for scheduling a device timer).
    public func device(_ serverTime: Date) -> Date { serverTime.addingTimeInterval(-offset) }
}

/// When a live share stops, and what the timer sheet offers (FSD §4 Stop rule, Auto-expiry,
/// 1-hour warning; prototype `endAt`, `limitSoon`, `stopOptions`). All times are the server's.
public struct ShareCountdown: Hashable, Sendable {
    public var expiresAt: Date
    public var stopRule: TMLStopRule
    public var stopAt: Date?

    public init(expiresAt: Date, stopRule: TMLStopRule, stopAt: Date?) {
        self.expiresAt = expiresAt
        self.stopRule = stopRule
        self.stopAt = stopAt
    }

    /// When sharing ends at the latest: the timer (capped at the limit), or the limit for the call
    /// rule, which may end sooner with the call.
    public var endsAt: Date {
        guard stopRule != .call, let stopAt else { return expiresAt }
        return min(stopAt, expiresAt)
    }

    /// Whether the 1-hour limit, not a timer, ends it (also when `stop_at` is `expires_at`).
    public var endsAtLimit: Bool { endsAt == expiresAt }

    /// How a local end is recorded until the server says (x-decisions Q-SESSION-END): the limit when
    /// the end is `expires_at`, otherwise the timer.
    public var dueReason: ShareEndReason { endsAtLimit ? .limit : .timer }

    /// Time left at `now`, never negative.
    public func remaining(at now: Date) -> TimeInterval { max(0, endsAt.timeIntervalSince(now)) }

    /// Whether the session is over by the clock at `now`, before the server marks it.
    public func isDue(at now: Date) -> Bool { now >= endsAt }

    /// The quiet "Sharing stops at 10:38 pm · 1-hour limit" line: from 5 minutes before
    /// `expires_at`, when the limit is what ends sharing.
    public func showsLimitWarning(at now: Date) -> Bool {
        endsAtLimit && !isDue(at: now)
            && now >= expiresAt.addingTimeInterval(-TimeInterval(TMLSchemaConstants.expiryWarningMinutes * 60))
    }

    /// The timer sheet's choices at `now`: When the call ends while the session's own call is
    /// connected, each timer that would end before the limit, then At the 1-hour limit.
    public func choices(at now: Date, callAvailable: Bool) -> [StopChoice] {
        var choices: [StopChoice] = callAvailable ? [.call] : []
        for minutes in TMLStopMinutes.allCases where now.addingTimeInterval(TimeInterval(minutes.rawValue * 60)) < expiresAt {
            choices.append(.minutes(minutes))
        }
        choices.append(.limit)
        return choices
    }

    /// The session fields for picking `choice` at `now`: a timer is now plus its minutes, capped at
    /// `expires_at`; the limit is `expires_at`; the call has none.
    public func change(to choice: StopChoice, at now: Date) -> StopRuleChange {
        switch choice {
        case .call:
            return StopRuleChange(stopRule: .call)
        case .minutes(let minutes):
            let at = min(now.addingTimeInterval(TimeInterval(minutes.rawValue * 60)), expiresAt)
            return StopRuleChange(stopRule: .minutes, stopMinutes: minutes, stopAt: at)
        case .limit:
            return StopRuleChange(stopRule: .limit, stopAt: expiresAt)
        }
    }

    /// This countdown after `change`.
    public func applying(_ change: StopRuleChange) -> ShareCountdown {
        ShareCountdown(expiresAt: expiresAt, stopRule: change.stopRule, stopAt: change.stopAt)
    }
}
