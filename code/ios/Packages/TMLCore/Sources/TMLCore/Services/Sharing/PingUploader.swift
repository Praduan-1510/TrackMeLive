import Foundation

/// Writes the sharer's pings for one session (FSD §4 Battery-aware pings, §6 Design decisions, §7;
/// x-decisions Q-PING-WRITE).
///
/// - **Cadence.** At most one ping per interval (`PingCadence`: 3–5 s by movement and accuracy above
///   20% battery, 15 s to 10%, 60 s below), each with the newest fix. Fixes that arrive in between
///   coalesce: only the newest is kept.
/// - **What counts as a fix.** A valid position better than 100 m (FSD §7), or any valid one while
///   iOS gives the app only approximate positions, never coarser than 100 km. Fixes that are out
///   of order, older than 15 s when their turn comes, or under 2 s after the last ping sent
///   (the rules' spacing, offline backlog included) are dropped. A phone Core Location reports as
///   stationary keeps pinging its last position, timed now: it is still there.
/// - **Check-ins.** Every ping refreshes `last_ping_at`; without one for 30 s (no GPS, or a 60 s
///   interval) a check-in does, so losing GPS alone never ends share back.
/// - **Precision.** Approximate pings are rounded on the phone (`ApproximateLocation`). A change
///   applies from the next ping, which sets the session's `precision` in the same batch. While
///   Precise Location is off for the app, pings are Approximate whatever was chosen.
/// - **Offline.** One write at a time: while one is unanswered (Firestore holds writes while
///   offline) nothing else is sent, and newer fixes coalesce. A failed write is retried after 2, 4,
///   8, 16, then every 30 s: the same batch if nothing newer came, else the newest fix.
/// - **Refusals.** The rules refuse every write to a session that is over, and also a retried
///   batch that had landed after all. The uploader reads the session to tell them apart: when its
///   `last_fix_at` is at or after the refused ping's `recorded_at`, the ping was written.
/// - **The end.** Nothing is written from the moment the session is due by the server's clock
///   (`stop_at` or `expires_at`), from `stop()`, or once the server refuses a write for good. A
///   write already in flight then is the last.
///
/// Times are the phone's clock, except `endsAt` and `recorded_at`, which are the server's.
@MainActor
public final class PingUploader {
    /// Why the uploader stopped by itself.
    public enum End: Hashable, Sendable {
        /// The session is due by the server's clock.
        case due
        /// The server refused a write: the session is over, or the sign-in is.
        case refused(SharingError)
    }

    /// The uploader's thresholds, from the schema's FSD constants.
    public struct Timing: Hashable, Sendable {
        public var checkIn = TimeInterval(TMLSchemaConstants.checkInIntervalSeconds)
        public var noFix = TimeInterval(TMLSchemaConstants.noFixTimeoutSeconds)
        public var goodAccuracy = Double(TMLSchemaConstants.noFixAccuracyMeters)
        /// A fix older than this when its turn comes is dropped: it would show as Live for less
        /// than the viewer's minimum (FSD §7 Offline behavior).
        public var maxFixAge = TimeInterval(TMLSchemaConstants.liveStaleMinSeconds)
        /// A write unanswered this long shows as No connection.
        public var offlineAfter: TimeInterval = 10
        public var backoff: [TimeInterval] = [2, 4, 8, 16, 30]

        public init() {}
    }

    /// The rules' bounds on a ping (x-decisions Q-PING-WRITE).
    static let minSpacing = TimeInterval(TMLSchemaConstants.minPingSpacingSeconds)
    static let firstPingBeforeStart = TimeInterval(TMLSchemaConstants.firstPingBeforeStartMinutes * 60)
    static let maxAccuracy = Double(TMLSchemaConstants.maxAccuracyMeters)

    private enum Action {
        case ping(PingWrite)
        case checkIn
    }

    /// What a refused ping turned out to be.
    private enum Refusal {
        /// The session has it: a retry of a batch that had landed.
        case written
        /// The session is over (or gone).
        case over
        /// The session can't be read now; try again later.
        case unknown
    }

    public private(set) var status: UploadStatus = .waitingForFix
    /// The interval in use, in seconds (written as `ping_interval_s`).
    public private(set) var interval = Double(TMLSchemaConstants.initialPingIntervalSeconds)
    /// The precision of the pings written so far (the session's `precision`).
    public private(set) var precision: TMLPrecision
    /// The precision the next ping will be written at, when it differs from `precision`.
    public var pendingPrecision: TMLPrecision? {
        let next = effectivePrecision
        return next == precision ? nil : next
    }
    /// The newest ping the server accepted, as written.
    public private(set) var lastSent: SharedPoint?
    /// Its `recorded_at`.
    public var lastSentAt: Date? { lastSent?.recordedAt }
    public private(set) var isStopped = false

    /// Called after `status`, `interval`, `precision`, `pendingPrecision` or `lastSent` change.
    public var onChange: (@MainActor () -> Void)?
    /// Called once, when the uploader stops by itself.
    public var onEnd: (@MainActor (End) -> Void)?

    public let sessionId: String
    private let backend: any SessionBackend
    private let clock: any ShareClock
    private let battery: any BatteryMonitor
    private let timing: Timing
    private let serverClock: ServerClock
    private var endsAt: Date
    /// The session's `started_at`, on the server's clock and on the phone's.
    private let serverStartedAt: Date
    private let startedAt: Date

    private var started = false
    /// What the person chose; `effectivePrecision` is what goes out.
    private var chosenPrecision: TMLPrecision
    private var accuracyLimited = false
    private var stationary = false
    /// The newest usable fix not yet sent.
    private var newest: LocationFix?
    /// The newest usable fix seen, sent or not.
    private var lastFix: LocationFix?
    /// When the phone last had a usable fix (or confirmed it hadn't moved).
    private var lastUsableAt: Date?
    private var lastPingStartedAt: Date?
    /// `recorded_at` of the newest ping sent, landed or not: the next must be 2 s after it.
    private var lastAttemptedAt: Date?
    /// A ping that failed and may be sent again exactly as it was.
    private var retry: PingWrite?
    private var lastWriteAt: Date
    private var writeStartedAt: Date?
    private var failures = 0
    private var retryAt: Date?
    private var wake: Task<Void, Never>?

    /// - Parameters:
    ///   - startedAt: the session's `started_at` (server time); `last_ping_at` starts there.
    ///   - endsAt: when the session is due (server time): the earlier of `stop_at` and `expires_at`.
    public init(sessionId: String, backend: any SessionBackend, clock: any ShareClock, serverClock: ServerClock,
                battery: any BatteryMonitor, precision: TMLPrecision, startedAt: Date, endsAt: Date,
                timing: Timing = Timing()) {
        self.sessionId = sessionId
        self.backend = backend
        self.clock = clock
        self.serverClock = serverClock
        self.battery = battery
        self.precision = precision
        chosenPrecision = precision
        serverStartedAt = startedAt
        self.startedAt = serverClock.device(startedAt)
        lastWriteAt = serverClock.device(startedAt)
        self.endsAt = endsAt
        self.timing = timing
    }

    // MARK: Driving it

    public func start() {
        guard !started, !isStopped else { return }
        started = true
        pump()
    }

    /// Stops at once: nothing more is written. A write already sent may still land.
    public func stop() {
        isStopped = true
        wake?.cancel()
        wake = nil
    }

    /// A new update from the location stream.
    public func receive(_ update: LocationUpdate) {
        guard !isStopped else { return }
        let now = clock.now
        let wasLimited = accuracyLimited
        accuracyLimited = update.isAccuracyLimited
        if update.isStationary {
            stationary = true
            if lastFix != nil { lastUsableAt = now }
        } else if update.problem != nil || update.fix != nil {
            stationary = false
        }
        if let fix = update.fix, fix.isValid, fix.horizontalAccuracy <= Self.maxAccuracy,
           fix.horizontalAccuracy < timing.goodAccuracy || update.isAccuracyLimited,
           fix.timestamp > (newest?.timestamp ?? lastFix?.timestamp ?? .distantPast) {
            newest = fix
            lastFix = fix
            lastUsableAt = now
        }
        if wasLimited != accuracyLimited {
            dropRetryIfMorePrecise()
            onChange?()
        }
        pump()
    }

    /// The precision for the next ping on.
    public func setPrecision(_ precision: TMLPrecision) {
        guard !isStopped, precision != chosenPrecision else { return }
        chosenPrecision = precision
        dropRetryIfMorePrecise()
        onChange?()
        pump()
    }

    /// The timer changed: the session is now due at `endsAt` (server time).
    public func setEndsAt(_ endsAt: Date) {
        guard !isStopped else { return }
        self.endsAt = endsAt
        pump()
    }

    // MARK: The loop

    private var effectivePrecision: TMLPrecision { accuracyLimited ? .approximate : chosenPrecision }

    /// A failed precise ping is never retried once the share is Approximate.
    private func dropRetryIfMorePrecise() {
        if retry?.precision == .precise, effectivePrecision == .approximate { retry = nil }
    }

    private func isDue(_ now: Date) -> Bool { serverClock.server(now) >= endsAt }

    /// Decides what to do now, does it, and sleeps until the next thing to decide.
    private func pump() {
        guard started, !isStopped else { return }
        let now = clock.now
        if isDue(now) {
            finish(.due)
            return
        }
        refreshStatus(now)
        if writeStartedAt == nil, let action = nextAction(now) {
            perform(action, now: now)
        }
        schedule(now)
    }

    private func nextAction(_ now: Date) -> Action? {
        if let retryAt, now < retryAt { return nil }
        let serverNow = serverClock.server(now)
        let pingDue = lastPingStartedAt.map { now >= $0.addingTimeInterval(interval) } ?? true
        if pingDue {
            if let fix = newest {
                newest = nil
                let recordedAt = min(serverClock.server(fix.timestamp), serverNow)
                if now.timeIntervalSince(fix.timestamp) <= timing.maxFixAge, canSend(recordedAt) {
                    return .ping(write(fix, recordedAt: recordedAt))
                }
            }
            if let retry {
                self.retry = nil
                if serverNow.timeIntervalSince(retry.ping.recordedAt) <= timing.maxFixAge { return .ping(retry) }
            }
            if stationary, let fix = lastFix, canSend(serverNow) {
                return .ping(write(fix, recordedAt: serverNow))
            }
        }
        if now >= lastWriteAt.addingTimeInterval(timing.checkIn) { return .checkIn }
        return nil
    }

    /// Whether the rules take a ping recorded at `recordedAt`: 2 s after the last one sent, and for
    /// the first, no more than 5 minutes before the start.
    private func canSend(_ recordedAt: Date) -> Bool {
        if let lastAttemptedAt { return recordedAt >= lastAttemptedAt.addingTimeInterval(Self.minSpacing) }
        return recordedAt >= serverStartedAt.addingTimeInterval(-Self.firstPingBeforeStart)
    }

    private func write(_ fix: LocationFix, recordedAt: Date) -> PingWrite {
        let precision = effectivePrecision
        let interval = PingCadence.interval(batteryPercent: battery.percent,
                                            motion: PingCadence.Motion(speed: fix.speed, stationary: stationary),
                                            hasGoodFix: fix.horizontalAccuracy < timing.goodAccuracy)
        return PingWrite(ping: ApproximateLocation.ping(for: fix, precision: precision, recordedAt: recordedAt),
                         pingInterval: interval, precision: precision)
    }

    private func perform(_ action: Action, now: Date) {
        writeStartedAt = now
        let backend = backend, sessionId = sessionId
        switch action {
        case .ping(let write):
            lastPingStartedAt = now
            lastAttemptedAt = max(lastAttemptedAt ?? write.ping.recordedAt, write.ping.recordedAt)
            setInterval(write.pingInterval)
            Task { [weak self] in
                do throws(SharingError) {
                    try await backend.writePing(sessionId: sessionId, write)
                    self?.completed(nil, ping: write)
                } catch .sessionEnded {
                    // Refused: over, or a retry of a batch that had landed. The session says which.
                    switch await Self.refusal(of: write, sessionId: sessionId, backend: backend) {
                    case .written: self?.completed(nil, ping: write)
                    case .over: self?.completed(.sessionEnded, ping: write)
                    case .unknown: self?.completed(.offline, ping: write)
                    }
                } catch {
                    self?.completed(error, ping: write)
                }
            }
        case .checkIn:
            if !hasSignal(now) {
                setInterval(PingCadence.interval(batteryPercent: battery.percent, motion: .still, hasGoodFix: false))
            }
            let interval = interval
            Task { [weak self] in
                do throws(SharingError) {
                    try await backend.checkIn(sessionId: sessionId, pingInterval: interval)
                    self?.completed(nil, ping: nil)
                } catch {
                    self?.completed(error, ping: nil)
                }
            }
        }
    }

    /// After a refused ping: written when the session's `last_fix_at` is at or after the ping's
    /// `recorded_at` (x-decisions Q-PING-WRITE), otherwise over.
    private static func refusal(of write: PingWrite, sessionId: String, backend: any SessionBackend) async -> Refusal {
        do throws(SharingError) {
            guard let session = try await backend.fetchSession(sessionId: sessionId) else { return .over }
            return session.lastFixAt.map { $0 >= write.ping.recordedAt } == true ? .written : .over
        } catch {
            return error.isRetryable ? .unknown : .over
        }
    }

    private func completed(_ error: SharingError?, ping: PingWrite?) {
        guard !isStopped else { return }
        let now = clock.now
        writeStartedAt = nil
        switch error {
        case nil:
            failures = 0
            retryAt = nil
            lastWriteAt = now
            if let ping {
                lastSent = SharedPoint(ping)
                precision = ping.precision
                onChange?()
            }
        case .sessionEnded?, .signInEnded?, .notSignedIn?:
            finish(.refused(error ?? .sessionEnded))
            return
        case let error?:
            failures += 1
            retryAt = now.addingTimeInterval(timing.backoff[min(failures, timing.backoff.count) - 1])
            // The same batch goes again unless a newer fix comes first; it's dropped once stale.
            if let ping, error.isRetryable { retry = ping }
        }
        pump()
    }

    private func hasSignal(_ now: Date) -> Bool {
        if stationary, lastFix != nil { return true }
        return lastUsableAt.map { now.timeIntervalSince($0) < timing.noFix } ?? false
    }

    private func refreshStatus(_ now: Date) {
        let next: UploadStatus
        if failures > 0 || writeStartedAt.map({ now.timeIntervalSince($0) >= timing.offlineAfter }) == true {
            next = .offline
        } else if hasSignal(now) {
            next = .live
        } else if lastFix == nil, now.timeIntervalSince(startedAt) < timing.noFix {
            next = .waitingForFix
        } else {
            next = .noSignal(lastFixAt: lastSentAt)
        }
        if next != status {
            status = next
            onChange?()
        }
    }

    private func setInterval(_ value: Double) {
        guard value != interval else { return }
        interval = value
        onChange?()
    }

    /// Sleeps until the earliest moment something can change: a ping or check-in falling due, a
    /// retry, the status turning (no signal, offline), or the end.
    private func schedule(_ now: Date) {
        var deadlines = [serverClock.device(endsAt)]
        if let writeStartedAt {
            if status != .offline { deadlines.append(writeStartedAt.addingTimeInterval(timing.offlineAfter)) }
        } else {
            if let retryAt { deadlines.append(retryAt) }
            if newest != nil || retry != nil || (stationary && lastFix != nil) {
                deadlines.append(lastPingStartedAt.map { $0.addingTimeInterval(interval) } ?? now)
            }
            deadlines.append(lastWriteAt.addingTimeInterval(timing.checkIn))
        }
        if let lastUsableAt, !stationary { deadlines.append(lastUsableAt.addingTimeInterval(timing.noFix)) }
        if lastFix == nil { deadlines.append(startedAt.addingTimeInterval(timing.noFix)) }
        let next = deadlines.filter { $0 > now }.min() ?? now.addingTimeInterval(0.25)
        let delay = Duration.milliseconds(Int64((next.timeIntervalSince(now) * 1000).rounded(.up)))
        let clock = clock
        wake?.cancel()
        wake = Task { [weak self] in
            do {
                try await clock.sleep(for: delay)
            } catch {
                return
            }
            self?.pump()
        }
    }

    private func finish(_ end: End) {
        guard !isStopped else { return }
        stop()
        onEnd?(end)
    }
}
