import Foundation

/// `shareSessions` and the session callables without a backend: what the app runs on until Xcode
/// day, and what the tests drive. It acts like the server: one session at a time, the times on the
/// server's clock (`serverOffset` ahead of the phone), and the rules' checks on the sharer's writes,
/// each refusal reported as Firestore reports it (`.sessionEnded`): refused once the session is over,
/// Approximate pings under 500 m, accuracy over 100 km, `recorded_at` more than 60 s ahead, under
/// 2 s after `last_fix_at`, or a first ping more than 5 minutes before `started_at`
/// (x-decisions Q-PING-WRITE).
@MainActor
public final class FakeSessionBackend: SessionBackend {
    /// What the backend was asked to do, in order.
    public enum Call: Hashable, Sendable {
        case create(TMLCreateSessionRequest)
        case stop(String)
        case discard(String)
        case stopRule(String, StopRuleChange)
        case precision(String, TMLPrecision)
        case ping(String, PingWrite)
        case checkIn(String, Double)
        case fetch(String)
    }

    /// How long each call takes, so loading states show. Zero in tests.
    public var latency: Duration
    /// The server's clock minus the phone's, in seconds.
    public var serverOffset: TimeInterval
    /// The sharer snapshot sessions are created with.
    public var sharer: TMLSharerSnapshot

    /// The next `createSession` fails with this, once.
    public var nextCreateError: SharingError?
    /// The next `stopSession` calls fail with these, in order.
    public var stopErrors: [SharingError] = []
    /// The next `discardSession` calls fail with these, in order.
    public var discardErrors: [SharingError] = []
    /// The next timer or precision write fails with this, once.
    public var nextFieldWriteError: SharingError?
    /// The next ping and check-in writes fail with these, in order (before any rule check).
    public var writeErrors: [SharingError] = []
    /// While true, ping and check-in writes wait (as Firestore's do offline) until `releaseWrites()`.
    public var holdsWrites = false
    /// The next this-many ping writes land on the server, then fail with `.offline` anyway, as a
    /// batch can when the connection drops before the answer.
    public var landsThenFails = 0
    /// The next `fetchSession` calls fail with these, in order.
    public var fetchErrors: [SharingError] = []

    public private(set) var calls: [Call] = []
    /// Ping and check-in writes the server accepted, per session.
    public private(set) var acceptedPings: [String: [TMLPing]] = [:]
    public private(set) var acceptedCheckIns: [String: Int] = [:]
    /// Writes the rules refused.
    public private(set) var refusedWrites = 0

    private let clock: any ShareClock
    private var sessions: [String: TMLShareSession] = [:]
    private var activeSessionId: String?
    private var listeners: [UUID: (sessionId: String, continuation: AsyncStream<SessionSnapshot>.Continuation)] = [:]
    private var held: [CheckedContinuation<Void, Never>] = []
    private var nextId = 1

    public init(clock: any ShareClock = SystemShareClock(), serverOffset: TimeInterval = 0, latency: Duration = .zero,
                sharer: TMLSharerSnapshot = TMLSharerSnapshot(name: "Alex", mascotId: .fox, mascotColor: .original)) {
        self.clock = clock
        self.serverOffset = serverOffset
        self.latency = latency
        self.sharer = sharer
    }

    /// A share link as the server builds it.
    public nonisolated static func link(token: String) -> URL {
        URL(string: "https://trackme.live\(TMLSchemaConstants.shareLinkPath)\(token)")!
    }

    /// The server's clock now.
    public var serverNow: Date { clock.now.addingTimeInterval(serverOffset) }

    /// A session as the server has it.
    public func session(_ id: String) -> TMLShareSession? { sessions[id] }

    /// Writes waiting for `releaseWrites()`.
    public var heldWrites: Int { held.count }

    // MARK: SessionBackend

    public func createSession(_ request: TMLCreateSessionRequest) async throws(SharingError) -> TMLCreateSessionResponse {
        await wait()
        calls.append(.create(request))
        if let error = nextCreateError {
            nextCreateError = nil
            throw error
        }
        endDueSessions()
        if let active = activeSessionId, sessions[active]?.status == .active {
            throw .alreadySharing(sessionId: active)
        }
        if request.stopRule == .minutes, request.stopMinutes == nil { throw .rejected(field: "stop_minutes") }
        if request.stopRule == .call, request.callId == nil { throw .rejected(field: "stop_rule") }
        // Whole milliseconds, as Firestore keeps them.
        let startedAt = Date(timeIntervalSince1970: (serverNow.timeIntervalSince1970 * 1000).rounded() / 1000)
        let expiresAt = startedAt.addingTimeInterval(TimeInterval(TMLSchemaConstants.sessionLimitMinutes * 60))
        let stopAt: Date? = switch request.stopRule {
        case .call: nil
        case .limit: expiresAt
        case .minutes: min(startedAt.addingTimeInterval(TimeInterval((request.stopMinutes?.rawValue ?? 0) * 60)), expiresAt)
        }
        let id = "session-\(nextId)"
        let token = String(format: "tok%019d", nextId)
        nextId += 1
        sessions[id] = TMLShareSession(
            status: .active, startedAt: startedAt, expiresAt: expiresAt, stopRule: request.stopRule,
            stopMinutes: request.stopMinutes, stopAt: stopAt, callId: request.callId, callActive: request.callId != nil,
            shareBackAllowed: request.callId != nil && request.shareBackAllowed, lastPingAt: startedAt,
            pingIntervalS: Double(TMLSchemaConstants.initialPingIntervalSeconds), precision: request.precision,
            sharer: sharer, viewerSharing: false
        )
        activeSessionId = id
        return TMLCreateSessionResponse(
            sessionId: id, linkToken: token, linkUrl: Self.link(token: token).absoluteString,
            startedAt: Int64((startedAt.timeIntervalSince1970 * 1000).rounded()),
            expiresAt: Int64((expiresAt.timeIntervalSince1970 * 1000).rounded())
        )
    }

    public func sessionUpdates(sessionId: String) -> AsyncStream<SessionSnapshot> {
        let (stream, continuation) = AsyncStream.makeStream(of: SessionSnapshot.self, bufferingPolicy: .bufferingNewest(8))
        let id = UUID()
        listeners[id] = (sessionId, continuation)
        continuation.yield(snapshot(sessionId))
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor [weak self] in self?.listeners[id] = nil }
        }
        return stream
    }

    public func stopSession(sessionId: String) async throws(SharingError) -> TMLStopSessionResponse {
        await wait()
        calls.append(.stop(sessionId))
        if !stopErrors.isEmpty { throw stopErrors.removeFirst() }
        endDueSessions()
        guard var session = sessions[sessionId] else { throw .sessionEnded }
        if session.status == .active {
            session.status = .stopped
            session.endedAt = serverNow
            session.endReason = .stopped
            session.viewerSharing = false
            store(session, id: sessionId)
        }
        return TMLStopSessionResponse(sessionId: sessionId, endedAt: Self.ms(session.endedAt ?? serverNow),
                                      endReason: session.endReason ?? .stopped)
    }

    public func discardSession(sessionId: String) async throws(SharingError) {
        await wait()
        calls.append(.discard(sessionId))
        if !discardErrors.isEmpty { throw discardErrors.removeFirst() }
        guard let session = sessions[sessionId] else { return }
        if session.firstViewedAt != nil { throw .linkOpened }
        sessions[sessionId] = nil
        acceptedPings[sessionId] = nil
        if activeSessionId == sessionId { activeSessionId = nil }
        notify(sessionId)
    }

    public func updateStopRule(sessionId: String, _ change: StopRuleChange) async throws(SharingError) {
        await wait()
        calls.append(.stopRule(sessionId, change))
        if let error = nextFieldWriteError {
            nextFieldWriteError = nil
            throw error
        }
        guard var session = liveSession(sessionId) else { throw refuse() }
        let now = serverNow
        let valid: Bool = switch change.stopRule {
        case .minutes:
            // stop_at = min(now + minutes, expires_at) by the server's clock, within the clock skew;
            // exactly expires_at once now + minutes passes it.
            if let minutes = change.stopMinutes, let stopAt = change.stopAt, stopAt > now, stopAt <= session.expiresAt {
                now.addingTimeInterval(TimeInterval(minutes.rawValue * 60)) >= session.expiresAt
                    ? stopAt == session.expiresAt
                    : abs(stopAt.timeIntervalSince(now.addingTimeInterval(TimeInterval(minutes.rawValue * 60))))
                        <= TimeInterval(TMLSchemaConstants.pingClockSkewSeconds)
            } else {
                false
            }
        case .limit:
            change.stopMinutes == nil && change.stopAt == session.expiresAt
        case .call:
            change.stopMinutes == nil && change.stopAt == nil && session.callId != nil && session.callEndedAt == nil
        }
        guard valid else { throw refuse() }
        session.stopRule = change.stopRule
        session.stopMinutes = change.stopMinutes
        session.stopAt = change.stopAt
        store(session, id: sessionId)
    }

    public func requestPrecision(sessionId: String, _ precision: TMLPrecision, place: PlaceUpdate?) async throws(SharingError) {
        await wait()
        calls.append(.precision(sessionId, precision))
        if let error = nextFieldWriteError {
            nextFieldWriteError = nil
            throw error
        }
        guard var session = liveSession(sessionId) else { throw refuse() }
        session.precisionNext = precision
        store(session, id: sessionId)
    }

    public func writePing(sessionId: String, _ write: PingWrite) async throws(SharingError) {
        calls.append(.ping(sessionId, write))
        try await writeGate()
        guard var session = liveSession(sessionId) else { throw refuse() }
        let ping = write.ping
        let minimumAccuracy = write.precision == .approximate ? Double(TMLSchemaConstants.approximateRoundingMeters) : 0
        let spaced: Bool = if let last = session.lastFixAt {
            ping.recordedAt >= last.addingTimeInterval(TimeInterval(TMLSchemaConstants.minPingSpacingSeconds))
        } else {
            ping.recordedAt >= session.startedAt.addingTimeInterval(-TimeInterval(TMLSchemaConstants.firstPingBeforeStartMinutes * 60))
        }
        guard (-90...90).contains(ping.lat), (-180...180).contains(ping.lng), ping.accuracyM >= minimumAccuracy,
              ping.accuracyM <= Double(TMLSchemaConstants.maxAccuracyMeters),
              ping.recordedAt <= serverNow.addingTimeInterval(TimeInterval(TMLSchemaConstants.pingClockSkewSeconds)),
              spaced, write.pingInterval > 0, write.pingInterval <= Double(TMLSchemaConstants.maxPingIntervalSeconds)
        else { throw refuse() }
        acceptedPings[sessionId, default: []].append(ping)
        session.lastPingAt = serverNow
        session.lastFixAt = ping.recordedAt
        session.pingIntervalS = write.pingInterval
        session.precision = write.precision
        session.precisionNext = nil
        store(session, id: sessionId)
        if landsThenFails > 0 {
            landsThenFails -= 1
            throw .offline
        }
    }

    public func fetchSession(sessionId: String) async throws(SharingError) -> TMLShareSession? {
        await wait()
        calls.append(.fetch(sessionId))
        if !fetchErrors.isEmpty { throw fetchErrors.removeFirst() }
        endDueSessions()
        return sessions[sessionId]
    }

    public func checkIn(sessionId: String, pingInterval: Double) async throws(SharingError) {
        calls.append(.checkIn(sessionId, pingInterval))
        try await writeGate()
        guard var session = liveSession(sessionId),
              pingInterval > 0, pingInterval <= Double(TMLSchemaConstants.maxPingIntervalSeconds) else { throw refuse() }
        acceptedCheckIns[sessionId, default: 0] += 1
        session.lastPingAt = serverNow
        session.pingIntervalS = pingInterval
        store(session, id: sessionId)
    }

    // MARK: The server's side, for tests

    /// Lets held writes through, in order.
    public func releaseWrites() {
        holdsWrites = false
        let waiting = held
        held = []
        for continuation in waiting { continuation.resume() }
    }

    /// The first open of the link (redeemLinkToken).
    public func markViewed(_ sessionId: String) {
        guard var session = sessions[sessionId], session.firstViewedAt == nil else { return }
        session.firstViewedAt = serverNow
        store(session, id: sessionId)
    }

    /// Ends a session as a function would: `reason` at `at` (now by default).
    public func end(_ sessionId: String, reason: TMLEndReason, at: Date? = nil) {
        guard var session = sessions[sessionId], session.status == .active else { return }
        session.status = .stopped
        session.endedAt = at ?? serverNow
        session.endReason = reason
        session.viewerSharing = false
        store(session, id: sessionId)
    }

    /// The scheduled stop job: ends every session past `stop_at` or `expires_at`, as of when it was
    /// due (x-decisions Q-SESSION-END).
    public func endDueSessions() {
        let now = serverNow
        for (id, session) in sessions where session.status == .active {
            let countdown = ShareCountdown(expiresAt: session.expiresAt, stopRule: session.stopRule, stopAt: session.stopAt)
            if countdown.isDue(at: now) { end(id, reason: countdown.dueReason.endReason, at: countdown.endsAt) }
        }
    }

    /// Deletes a session (the account was deleted elsewhere).
    public func delete(_ sessionId: String) {
        sessions[sessionId] = nil
        if activeSessionId == sessionId { activeSessionId = nil }
        notify(sessionId)
    }

    /// Fails every open listener, as Firestore does on an error: one `.failed`, then nothing more.
    public func failListeners(with error: SharingError = .offline) {
        let open = listeners
        listeners = [:]
        for listener in open.values {
            listener.continuation.yield(.failed(error))
            listener.continuation.finish()
        }
    }

    /// Open session listeners.
    public var listenerCount: Int { listeners.count }

    // MARK: Private

    /// The session when the rules would let the sharer write it: active, before `stop_at` and
    /// `expires_at` by the server's clock.
    private func liveSession(_ id: String) -> TMLShareSession? {
        guard let session = sessions[id], session.status == .active else { return nil }
        let countdown = ShareCountdown(expiresAt: session.expiresAt, stopRule: session.stopRule, stopAt: session.stopAt)
        return countdown.isDue(at: serverNow) ? nil : session
    }

    private func refuse() -> SharingError {
        refusedWrites += 1
        return .sessionEnded
    }

    private func writeGate() async throws(SharingError) {
        if !writeErrors.isEmpty { throw writeErrors.removeFirst() }
        if holdsWrites { await withCheckedContinuation { held.append($0) } }
        await wait()
    }

    private func store(_ session: TMLShareSession, id: String) {
        sessions[id] = session
        if session.status == .stopped, activeSessionId == id { activeSessionId = nil }
        notify(id)
    }

    private func notify(_ sessionId: String) {
        let update = snapshot(sessionId)
        for listener in listeners.values where listener.sessionId == sessionId {
            listener.continuation.yield(update)
        }
    }

    private func snapshot(_ sessionId: String) -> SessionSnapshot {
        sessions[sessionId].map(SessionSnapshot.session) ?? .missing
    }

    private func wait() async {
        if latency > .zero { try? await clock.sleep(for: latency) }
    }

    private static func ms(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded()) }
}
