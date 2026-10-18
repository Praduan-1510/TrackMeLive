import Foundation
import Observation

/// Runs the share (see `SharingService`): the session callables, the session's listener, location
/// in the background and the ping uploader.
///
/// - **Start.** `createSession`, then at once the location stream (background-capable, held only
///   while the share runs) and the uploader, and a listener on `shareSessions/{id}`. The server's
///   clock is estimated from `started_at` (`ServerClock`).
/// - **While live.** The listener brings the viewer's side (first open, share back, the call).
///   The phone is the source of truth for what it writes itself: the stop fields while a timer
///   change is on its way, the precision and the interval.
/// - **The end.** The server's word wins: a `stopped` snapshot ends the share with its reason and
///   time. The phone doesn't wait for it when it knows: Stop ends it at once, and so does the
///   session falling due by the server's clock (reason timer or limit, at the due time); the
///   snapshot then confirms. If none comes within a minute of a local end (the stop job runs every
///   minute), `stopSession`, which is idempotent and reports how a due session ended, confirms it.
///   Stop and discard are retried in the background until the server has them.
@MainActor
@Observable
public final class ShareController: SharingService {
    public private(set) var state: ShareState = .idle

    /// One share's machinery, from `createSession` until the server has recorded its end.
    @MainActor
    private final class Run {
        let sessionId: String
        let serverClock: ServerClock
        var uploader: PingUploader?
        var location: Task<Void, Never>?
        var listener: Task<Void, Never>?
        var confirm: Task<Void, Never>?
        var chosenPrecision: TMLPrecision
        var stopChanges = 0
        var everSharedBack = false
        var confirmed = false

        init(sessionId: String, serverClock: ServerClock, precision: TMLPrecision) {
            self.sessionId = sessionId
            self.serverClock = serverClock
            chosenPrecision = precision
        }

        /// Location and pings stop; the listener stays until the end is confirmed.
        func stopUploading() {
            uploader?.stop()
            uploader = nil
            location?.cancel()
            location = nil
        }

        func tearDown() {
            stopUploading()
            listener?.cancel()
            listener = nil
            confirm?.cancel()
            confirm = nil
        }
    }

    @ObservationIgnored private let backend: any SessionBackend
    @ObservationIgnored private let location: any LocationStream
    @ObservationIgnored private let access: any LocationAccess
    @ObservationIgnored private let battery: any BatteryMonitor
    @ObservationIgnored private let clock: any ShareClock
    @ObservationIgnored private let timing: PingUploader.Timing
    /// Waits between retries of Stop, discard and the listener: 2, 4, 8, 16, 32, then every 60 s.
    @ObservationIgnored private let retryDelays: [TimeInterval]
    /// How long after a local end the snapshot has to confirm it before `stopSession` is asked.
    @ObservationIgnored private let confirmAfter: TimeInterval
    @ObservationIgnored private var run: Run?
    /// Sessions whose Stop or discard is still being retried, after a newer share took over.
    @ObservationIgnored private var background: [String: Task<Void, Never>] = [:]

    public init(backend: any SessionBackend, location: any LocationStream, access: any LocationAccess,
                battery: any BatteryMonitor, clock: any ShareClock = SystemShareClock(),
                timing: PingUploader.Timing = PingUploader.Timing(),
                retryDelays: [TimeInterval] = [2, 4, 8, 16, 32, 60], confirmAfter: TimeInterval = 65) {
        self.backend = backend
        self.location = location
        self.access = access
        self.battery = battery
        self.clock = clock
        self.timing = timing
        self.retryDelays = retryDelays.isEmpty ? [60] : retryDelays
        self.confirmAfter = confirmAfter
    }

    // MARK: SharingService

    public func start(_ options: ShareOptions) async throws(SharingError) -> ShareLink {
        switch state {
        case .live(let live): throw .alreadySharing(sessionId: live.sessionId)
        case .starting: throw .alreadySharing(sessionId: nil)
        case .idle, .ended: break
        }
        guard access.authorization.isAllowed else { throw .locationOff }
        var request = options.request
        // With Precise Location off for the app, shares are Approximate (FSD §8).
        if !access.authorization.precise { request.precision = .approximate }

        let previous = state
        state = .starting
        let sent = clock.now
        let response: TMLCreateSessionResponse
        do {
            response = try await backend.createSession(request)
        } catch {
            state = previous
            throw error
        }
        let startedAt = SharingWire.date(ms: response.startedAt)
        let expiresAt = SharingWire.date(ms: response.expiresAt)
        guard let url = URL(string: response.linkUrl), url.scheme == "https" || url.scheme == "http" else {
            // A link nobody can open: take the session back rather than share it.
            state = previous
            retryInBackground(response.sessionId) { [backend] () async throws(SharingError) in
                try await backend.discardSession(sessionId: response.sessionId)
            }
            throw .failed
        }
        let serverClock = ServerClock(serverTime: startedAt, sent: sent, received: clock.now)
        let stop: StopRuleChange = switch request.stopRule {
        case .call: StopRuleChange(stopRule: .call)
        case .limit: StopRuleChange(stopRule: .limit, stopAt: expiresAt)
        case .minutes:
            StopRuleChange(stopRule: .minutes, stopMinutes: request.stopMinutes,
                           stopAt: min(startedAt.addingTimeInterval(TimeInterval((request.stopMinutes?.rawValue ?? 0) * 60)), expiresAt))
        }
        let link = ShareLink(sessionId: response.sessionId, url: url)
        let live = LiveShare(
            sessionId: response.sessionId, link: link, viewerName: request.viewerName,
            startedAt: startedAt, expiresAt: expiresAt,
            stopRule: stop.stopRule, stopMinutes: stop.stopMinutes, stopAt: stop.stopAt,
            precision: request.precision, callId: request.callId, callActive: request.callId != nil,
            shareBackAllowed: request.shareBackAllowed,
            pingInterval: Double(TMLSchemaConstants.initialPingIntervalSeconds), upload: .waitingForFix, clock: serverClock
        )
        // A previous share still confirming its end carries on in the background.
        if let old = run { hand(old) }
        let run = Run(sessionId: response.sessionId, serverClock: serverClock, precision: request.precision)
        self.run = run
        state = .live(live)
        startUploading(run, live: live)
        run.listener = Task { [weak self] in await self?.listen(run) }
        return link
    }

    public func discard() async throws(SharingError) {
        guard let live = state.live, let run, run.sessionId == live.sessionId else { return }
        run.stopUploading()
        state = .idle
        do {
            try await backend.discardSession(sessionId: live.sessionId)
            finish(run)
        } catch .linkOpened {
            // Someone opened it meanwhile: the share carries on.
            guard self.run === run, state == .idle else { throw .linkOpened }
            state = .live(live)
            startUploading(run, live: live)
            throw .linkOpened
        } catch .sessionEnded {
            finish(run)
        } catch {
            // Nobody has the link, and the stop job ends it at its timer anyway; keep trying.
            if error.isRetryable {
                retryInBackground(live.sessionId, after: true) { [backend] () async throws(SharingError) in
                    try await backend.discardSession(sessionId: live.sessionId)
                }
            }
            finish(run)
        }
    }

    public func stop() async {
        guard let live = state.live, let run, run.sessionId == live.sessionId else { return }
        run.stopUploading()
        state = .ended(ended(live, run: run, reason: .stopped, at: run.serverClock.server(clock.now), confirmed: false))
        // One attempt here; offline, the rest go on in the background while the ended screen shows.
        if await stopOnce(run) == false {
            run.confirm = Task { [weak self] in await self?.confirmByStopping(run, failures: 1) }
        }
    }

    public func changeStop(to choice: StopChoice) async throws(SharingError) {
        guard let live = state.live, let run, run.sessionId == live.sessionId else { throw .sessionEnded }
        if choice == .call, !live.callChoiceAvailable { throw .rejected(field: TMLShareSession.Field.stopRule.rawValue) }
        let change = live.countdown.change(to: choice, at: run.serverClock.server(clock.now))
        let before = StopRuleChange(stopRule: live.stopRule, stopMinutes: live.stopMinutes, stopAt: live.stopAt)
        guard change != before else { return }
        applyStop(change, to: run)
        run.stopChanges += 1
        defer { run.stopChanges -= 1 }
        do {
            try await backend.updateStopRule(sessionId: live.sessionId, change)
        } catch {
            if let now = state.live, now.sessionId == live.sessionId, now.stopRule == change.stopRule,
               now.stopMinutes == change.stopMinutes, now.stopAt == change.stopAt {
                applyStop(before, to: run)
            }
            throw error
        }
    }

    public func changePrecision(to precision: TMLPrecision) async throws(SharingError) {
        guard let live = state.live, let run, run.sessionId == live.sessionId else { throw .sessionEnded }
        let previous = run.chosenPrecision
        guard precision != previous else { return }
        run.chosenPrecision = precision
        run.uploader?.setPrecision(precision)
        sync(run)
        do {
            try await backend.requestPrecision(sessionId: live.sessionId, precision)
        } catch {
            // Back to Precise only if the write failed for it; Approximate stays, whatever happens.
            if precision == .precise, self.run === run, run.chosenPrecision == precision {
                run.chosenPrecision = previous
                run.uploader?.setPrecision(previous)
                sync(run)
            }
            throw error
        }
    }

    public func dismissEnded() {
        if state.ended != nil { state = .idle }
    }

    // MARK: Uploading

    private func startUploading(_ run: Run, live: LiveShare) {
        let uploader = PingUploader(sessionId: run.sessionId, backend: backend, clock: clock, serverClock: run.serverClock,
                                    battery: battery, precision: live.precision, startedAt: live.startedAt,
                                    endsAt: live.countdown.endsAt, timing: timing)
        if run.chosenPrecision != live.precision { uploader.setPrecision(run.chosenPrecision) }
        uploader.onChange = { [weak self, weak run] in
            guard let self, let run else { return }
            self.sync(run)
        }
        uploader.onEnd = { [weak self, weak run] end in
            guard let self, let run else { return }
            self.uploaderEnded(run, end)
        }
        run.uploader = uploader
        let updates = location.updates(background: true)
        run.location = Task { [weak uploader] in
            for await update in updates {
                uploader?.receive(update)
            }
        }
        uploader.start()
    }

    /// The uploader's state, onto the live share.
    private func sync(_ run: Run) {
        guard self.run === run, var live = state.live, live.sessionId == run.sessionId, let uploader = run.uploader else { return }
        live.upload = uploader.status
        live.pingInterval = uploader.interval
        live.precision = uploader.precision
        live.precisionNext = uploader.pendingPrecision
        live.lastPoint = uploader.lastSent ?? live.lastPoint
        if state.live != live { state = .live(live) }
    }

    private func applyStop(_ change: StopRuleChange, to run: Run) {
        guard var live = state.live, live.sessionId == run.sessionId else { return }
        live.stopRule = change.stopRule
        live.stopMinutes = change.stopMinutes
        live.stopAt = change.stopAt
        state = .live(live)
        run.uploader?.setEndsAt(live.countdown.endsAt)
    }

    private func uploaderEnded(_ run: Run, _ end: PingUploader.End) {
        guard self.run === run, let live = state.live, live.sessionId == run.sessionId else { return }
        run.stopUploading()
        let countdown = live.countdown
        let now = run.serverClock.server(clock.now)
        let due = countdown.isDue(at: now)
        state = .ended(ended(live, run: run, reason: due ? countdown.dueReason : .stopped,
                             at: due ? countdown.endsAt : now, confirmed: false))
        switch end {
        case .due:
            // The stop job ends it within a minute; the snapshot confirms. Ask if it doesn't.
            let confirmAfter = confirmAfter
            run.confirm = Task { [weak self, clock] in
                do {
                    try await clock.sleep(for: .milliseconds(Int64(confirmAfter * 1000)))
                } catch {
                    return
                }
                await self?.confirmByStopping(run)
            }
        case .refused:
            // The server says it's over; stopSession says how (it's idempotent).
            run.confirm = Task { [weak self] in await self?.confirmByStopping(run) }
        }
    }

    // MARK: The session listener

    private func listen(_ run: Run) async {
        var failures = 0
        while !Task.isCancelled, !run.confirmed {
            for await snapshot in backend.sessionUpdates(sessionId: run.sessionId) {
                switch snapshot {
                case .session(let session):
                    failures = 0
                    apply(session, to: run)
                case .missing:
                    failures = 0
                    gone(run)
                case .failed:
                    break
                }
                if run.confirmed { return }
            }
            if Task.isCancelled || run.confirmed { return }
            failures += 1
            do {
                try await clock.sleep(for: delay(failures))
            } catch {
                return
            }
        }
    }

    private func apply(_ session: TMLShareSession, to run: Run) {
        run.everSharedBack = run.everSharedBack || session.viewerSharing
        if session.status == .stopped {
            confirm(run, reason: ShareEndReason(session.endReason ?? .stopped), at: session.endedAt,
                    firstViewedAt: session.firstViewedAt)
            return
        }
        guard self.run === run, var live = state.live, live.sessionId == run.sessionId else { return }
        live.firstViewedAt = session.firstViewedAt
        live.viewerSharing = session.viewerSharing
        live.callActive = session.callActive
        live.callEnded = session.callEndedAt != nil
        live.shareBackAllowed = session.shareBackAllowed
        live.shareBackRequestedAt = session.shareBackRequestedAt
        let changedStop = run.stopChanges == 0
            && (live.stopRule != session.stopRule || live.stopMinutes != session.stopMinutes || live.stopAt != session.stopAt)
        if changedStop {
            live.stopRule = session.stopRule
            live.stopMinutes = session.stopMinutes
            live.stopAt = session.stopAt
        }
        if state.live != live { state = .live(live) }
        if changedStop { run.uploader?.setEndsAt(live.countdown.endsAt) }
    }

    /// The session document is gone: discarded, or deleted with the account.
    private func gone(_ run: Run) {
        if self.run === run, let live = state.live, live.sessionId == run.sessionId {
            run.stopUploading()
            state = .ended(ended(live, run: run, reason: .stopped, at: run.serverClock.server(clock.now), confirmed: true))
        }
        confirm(run, reason: nil, at: nil, firstViewedAt: nil)
    }

    // MARK: Ending

    /// The server has recorded the end (`reason` and `at` nil: it didn't say how).
    private func confirm(_ run: Run, reason: ShareEndReason?, at: Date?, firstViewedAt: Date?) {
        guard !run.confirmed else { return }
        run.confirmed = true
        if self.run === run {
            if let live = state.live, live.sessionId == run.sessionId {
                state = .ended(ended(live, run: run, reason: reason ?? .stopped, at: at ?? run.serverClock.server(clock.now),
                                     confirmed: true))
            } else if var ended = state.ended, ended.sessionId == run.sessionId {
                if let reason { ended.reason = reason }
                if let at { ended.endedAt = at }
                if let firstViewedAt { ended.firstViewedAt = firstViewedAt }
                ended.sharedBack = ended.sharedBack || run.everSharedBack
                ended.confirmed = true
                state = .ended(ended)
            }
        }
        finish(run)
    }

    /// `stopSession` until the server answers, waiting between tries after `failures` failures.
    private func confirmByStopping(_ run: Run, failures: Int = 0) async {
        var failures = failures
        while !run.confirmed, !Task.isCancelled {
            if failures > 0 {
                do {
                    try await clock.sleep(for: delay(failures))
                } catch {
                    return
                }
            }
            guard let confirmed = await stopOnce(run), !confirmed else { return }
            failures += 1
        }
    }

    /// One `stopSession`. Idempotent: for a session that's already over it says how it ended.
    /// True when the end is confirmed, false when it may work later, nil when it never will.
    private func stopOnce(_ run: Run) async -> Bool? {
        do {
            let response = try await backend.stopSession(sessionId: run.sessionId)
            confirm(run, reason: ShareEndReason(response.endReason), at: SharingWire.date(ms: response.endedAt),
                    firstViewedAt: nil)
            return true
        } catch .sessionEnded {
            // Not found: it's gone, which is ended too.
            confirm(run, reason: nil, at: nil, firstViewedAt: nil)
            return true
        } catch {
            return error.isRetryable ? false : nil
        }
    }

    /// Done with a run: everything stops.
    private func finish(_ run: Run) {
        run.tearDown()
        if self.run === run { self.run = nil }
        background[run.sessionId] = nil
    }

    /// A run that's still confirming its end, when a new share starts: its confirmation carries on.
    private func hand(_ old: Run) {
        old.stopUploading()
        old.listener?.cancel()
        old.listener = nil
        guard !old.confirmed else { return }
        let backend = backend
        retryInBackground(old.sessionId) { () async throws(SharingError) in
            _ = try await backend.stopSession(sessionId: old.sessionId)
        }
    }

    private func retryInBackground(_ sessionId: String, after failed: Bool = false,
                                   _ attempt: @escaping @MainActor () async throws(SharingError) -> Void) {
        background[sessionId]?.cancel()
        background[sessionId] = Task { [weak self, clock] in
            var failures = failed ? 1 : 0
            while !Task.isCancelled {
                if failures > 0 {
                    guard let wait = self?.delay(failures) else { return }
                    do {
                        try await clock.sleep(for: wait)
                    } catch {
                        return
                    }
                }
                do throws(SharingError) {
                    try await attempt()
                    break
                } catch {
                    if !error.isRetryable { break }
                    failures += 1
                }
            }
            self?.background[sessionId] = nil
        }
    }

    private func delay(_ failures: Int) -> Duration {
        let seconds = retryDelays[min(max(failures, 1), retryDelays.count) - 1]
        return .milliseconds(Int64(seconds * 1000))
    }

    private func ended(_ live: LiveShare, run: Run, reason: ShareEndReason, at: Date, confirmed: Bool) -> EndedShare {
        EndedShare(sessionId: live.sessionId, reason: reason, startedAt: live.startedAt, endedAt: at,
                   viewerName: live.viewerName, firstViewedAt: live.firstViewedAt,
                   sharedBack: run.everSharedBack || live.viewerSharing, confirmed: confirmed)
    }
}
