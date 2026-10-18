import Foundation
import Observation

/// A sharing service with a state you set: previews, and view-model tests. Each call is recorded
/// and changes the state the obvious way, at once; set `nextError` to make the next throwing call
/// fail instead (the state is left as it was).
@MainActor
@Observable
public final class FixedSharingService: SharingService {
    public enum Call: Hashable, Sendable {
        case start(ShareOptions)
        case discard
        case stop
        case changeStop(StopChoice)
        case changePrecision(TMLPrecision)
        case dismissEnded
    }

    public var state: ShareState
    /// The next `start`, `discard`, `changeStop` or `changePrecision` throws this, once.
    public var nextError: SharingError?
    public private(set) var calls: [Call] = []

    public init(state: ShareState = .idle) {
        self.state = state
    }

    public func start(_ options: ShareOptions) async throws(SharingError) -> ShareLink {
        calls.append(.start(options))
        try throwNextError()
        let share = LiveShare.sample(options: options)
        state = .live(share)
        return share.link
    }

    public func discard() async throws(SharingError) {
        calls.append(.discard)
        try throwNextError()
        state = .idle
    }

    public func stop() async {
        calls.append(.stop)
        guard let live = state.live else { return }
        state = .ended(EndedShare(sessionId: live.sessionId, reason: .stopped, startedAt: live.startedAt,
                                  endedAt: live.clock.server(Date()), viewerName: live.viewerName,
                                  firstViewedAt: live.firstViewedAt, sharedBack: live.viewerSharing, confirmed: true))
    }

    public func changeStop(to choice: StopChoice) async throws(SharingError) {
        calls.append(.changeStop(choice))
        try throwNextError()
        guard var live = state.live else { return }
        let change = live.countdown.change(to: choice, at: live.clock.server(Date()))
        live.stopRule = change.stopRule
        live.stopMinutes = change.stopMinutes
        live.stopAt = change.stopAt
        state = .live(live)
    }

    public func changePrecision(to precision: TMLPrecision) async throws(SharingError) {
        calls.append(.changePrecision(precision))
        try throwNextError()
        guard var live = state.live else { return }
        live.precisionNext = precision == live.precision ? nil : precision
        state = .live(live)
    }

    public func dismissEnded() {
        calls.append(.dismissEnded)
        if state.ended != nil { state = .idle }
    }

    private func throwNextError() throws(SharingError) {
        if let error = nextError {
            nextError = nil
            throw error
        }
    }
}

extension LiveShare {
    /// A share that started a minute ago, for previews: a 30-minute timer, precise, link not opened,
    /// last seen at the start of `SimulatedRouteStream.demoRoute` (rounded when Approximate).
    public static func sample(options: ShareOptions = ShareOptions(stop: .minutes(.minutes30), shareBack: false, precision: .precise),
                              now: Date = Date()) -> LiveShare {
        let startedAt = now.addingTimeInterval(-60)
        let expiresAt = startedAt.addingTimeInterval(TimeInterval(TMLSchemaConstants.sessionLimitMinutes * 60))
        let request = options.request
        let countdown = ShareCountdown(expiresAt: expiresAt, stopRule: request.stopRule, stopAt: nil)
        let change = countdown.change(to: options.callId == nil && options.stop == .call ? .minutes(.minutes30) : options.stop,
                                      at: startedAt)
        return LiveShare(
            sessionId: "sample-session",
            link: ShareLink(sessionId: "sample-session", url: FakeSessionBackend.link(token: "AAAAAAAAAAAAAAAAAAAAAA")),
            viewerName: request.viewerName,
            startedAt: startedAt, expiresAt: expiresAt,
            stopRule: change.stopRule, stopMinutes: change.stopMinutes, stopAt: change.stopAt,
            precision: request.precision, callId: request.callId, callActive: request.callId != nil,
            shareBackAllowed: request.shareBackAllowed,
            pingInterval: Double(TMLSchemaConstants.initialPingIntervalSeconds), upload: .live,
            lastPoint: SharedPoint(PingWrite(
                ping: ApproximateLocation.ping(
                    for: LocationFix(latitude: SimulatedRouteStream.demoRoute[0].0, longitude: SimulatedRouteStream.demoRoute[0].1,
                                     horizontalAccuracy: 8, timestamp: now),
                    precision: request.precision, recordedAt: now),
                pingInterval: 5, precision: request.precision)),
            clock: ServerClock()
        )
    }
}
