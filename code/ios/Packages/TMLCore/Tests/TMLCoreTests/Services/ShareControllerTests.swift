import Foundation
import Testing
@testable import TMLCore

/// A share controller on fakes, on a clock the test moves.
@MainActor
final class ControllerRig {
    let clock = ManualShareClock()
    let backend: FakeSessionBackend
    let location = FakeLocationStream()
    let access: FakeLocationAccess
    let battery = FixedBattery(percent: 80)
    let controller: ShareController

    init(serverOffset: TimeInterval = 0, authorization: LocationAuthorization = LocationAuthorization(status: .whenInUse, hasAsked: true)) {
        backend = FakeSessionBackend(clock: clock, serverOffset: serverOffset)
        access = FakeLocationAccess(authorization: authorization)
        controller = ShareController(backend: backend, location: location, access: access, battery: battery, clock: clock)
    }

    static let manual = ShareOptions(viewerName: "Mom", stop: .minutes(.minutes15), shareBack: false, precision: .precise)

    @discardableResult
    func start(_ options: ShareOptions = ControllerRig.manual) async throws -> ShareLink {
        let link = try await controller.start(options)
        await ManualShareClock.settle()
        return link
    }

    func fix(_ lat: Double = 37.7850, accuracy: Double = 8) -> LocationFix {
        LocationFix(latitude: lat, longitude: -122.4025, horizontalAccuracy: accuracy, timestamp: clock.now, speed: 1.4)
    }

    func send(_ fix: LocationFix? = nil) async {
        location.send(fix ?? self.fix())
        await ManualShareClock.settle()
    }

    /// Moves time on, with a fresh fix every 4 s, as a phone on the move gives.
    func walk(_ seconds: Int) async {
        for _ in 0..<(seconds / 4) {
            await clock.advance(by: .seconds(4))
            await send()
        }
        if seconds % 4 > 0 { await clock.advance(by: .seconds(seconds % 4)) }
    }

    var live: LiveShare? { controller.state.live }
    var ended: EndedShare? { controller.state.ended }
    var sessionId: String? { live?.sessionId ?? ended?.sessionId }
    var pings: [TMLPing] { sessionId.flatMap { backend.acceptedPings[$0] } ?? [] }
    var writes: Int {
        backend.calls.filter {
            switch $0 {
            case .ping, .checkIn: true
            default: false
            }
        }.count
    }
    func stops() -> Int { backend.calls.filter { if case .stop = $0 { true } else { false } }.count }
}

@MainActor
@Suite("Share controller")
struct ShareControllerTests {
    // MARK: Start

    @Test func startCreatesTheSessionAndGoesLiveWithTheLink() async throws {
        let rig = ControllerRig()
        let link = try await rig.start()
        #expect(rig.backend.calls.first == .create(ControllerRig.manual.request))
        let live = try #require(rig.live)
        #expect(live.link == link)
        #expect(link.url.absoluteString.hasPrefix("https://trackme.live/s/"))
        #expect(live.viewerName == "Mom")
        #expect(live.stopRule == .minutes)
        #expect(live.stopAt == live.startedAt.addingTimeInterval(15 * 60))
        #expect(live.expiresAt == live.startedAt.addingTimeInterval(3600))
        #expect(live.upload == .waitingForFix)
        // Location runs, in the background, from the start.
        #expect(rig.location.isRunningInBackground)
        await rig.send()
        #expect(rig.pings.count == 1)
        #expect(rig.live?.upload == .live)
        #expect(rig.live?.lastPoint?.latitude == 37.7850)
        #expect(rig.live?.pingInterval == 4)
    }

    @Test func withoutLocationNothingStarts() async throws {
        let rig = ControllerRig(authorization: LocationAuthorization(status: .denied, hasAsked: true))
        await #expect(throws: SharingError.locationOff) { try await rig.start() }
        #expect(rig.backend.calls.isEmpty)
        #expect(rig.controller.state == .idle)
        #expect(rig.location.requests.isEmpty)
    }

    @Test func withoutPreciseLocationTheShareIsApproximate() async throws {
        let rig = ControllerRig(authorization: LocationAuthorization(status: .whenInUse, precise: false, hasAsked: true))
        try await rig.start()
        var request = ControllerRig.manual.request
        request.precision = .approximate
        #expect(rig.backend.calls.first == .create(request))
        #expect(rig.live?.precision == .approximate)
    }

    @Test func aFailedStartLeavesNothingRunning() async throws {
        let rig = ControllerRig()
        rig.backend.nextCreateError = .offline
        await #expect(throws: SharingError.offline) { try await rig.start() }
        #expect(rig.controller.state == .idle)
        #expect(rig.location.openStreams == 0)
        #expect(rig.backend.listenerCount == 0)
    }

    @Test func oneShareAtATime() async throws {
        let rig = ControllerRig()
        try await rig.start()
        let id = try #require(rig.sessionId)
        await #expect(throws: SharingError.alreadySharing(sessionId: id)) { try await rig.start() }
        #expect(rig.backend.calls.count(where: { if case .create = $0 { true } else { false } }) == 1)
    }

    @Test func theServersClockDecidesTheEnd() async throws {
        // The phone is 10 minutes behind the server: by its own clock the 15-minute timer would run 25.
        let rig = ControllerRig(serverOffset: 600)
        try await rig.start()
        let live = try #require(rig.live)
        #expect(abs(live.clock.offset - 600) < 0.01)
        await rig.walk(15 * 60 - 4)
        #expect(rig.live != nil)
        await rig.walk(8)
        let ended = try #require(rig.ended)
        #expect(ended.reason == .timer)
        #expect(ended.endedAt == live.stopAt)
        #expect(rig.backend.refusedWrites == 0)
    }

    // MARK: Stop

    @Test func stopEndsAtOnceThenTheServerConfirms() async throws {
        let rig = ControllerRig()
        try await rig.start()
        await rig.send()
        await rig.controller.stop()
        let ended = try #require(rig.ended)
        #expect(ended.reason == .stopped)
        #expect(ended.viewerName == "Mom")
        #expect(ended.confirmed)
        #expect(rig.stops() == 1)
        #expect(rig.backend.session(ended.sessionId)?.status == .stopped)
        // Location is off, in the background too, and nothing more is written.
        await ManualShareClock.settle()
        #expect(rig.location.openStreams == 0)
        #expect(!rig.location.isRunningInBackground)
        let writes = rig.writes
        await rig.walk(120)
        #expect(rig.writes == writes)
        #expect(rig.backend.listenerCount == 0)
    }

    @Test func stopRacingAPingInFlightWritesNothingAfter() async throws {
        let rig = ControllerRig()
        try await rig.start()
        rig.backend.holdsWrites = true
        await rig.send()
        #expect(rig.backend.heldWrites == 1)
        await rig.controller.stop()
        rig.backend.releaseWrites()
        await ManualShareClock.settle()
        // The ping already sent is refused (the session is over); nothing new goes out.
        #expect(rig.pings.isEmpty)
        let writes = rig.writes
        await rig.walk(60)
        #expect(rig.writes == writes)
        #expect(rig.ended?.reason == .stopped)
    }

    @Test func stopOfflineKeepsTryingUntilTheServerHasIt() async throws {
        let rig = ControllerRig()
        try await rig.start()
        rig.backend.stopErrors = [.offline, .offline]
        await rig.controller.stop()
        #expect(rig.ended?.confirmed == false)
        #expect(rig.ended?.reason == .stopped)
        #expect(rig.stops() == 1)
        await ManualShareClock.settle()
        #expect(rig.location.openStreams == 0)
        await rig.clock.advance(by: .seconds(2))
        #expect(rig.stops() == 2)
        await rig.clock.advance(by: .seconds(4))
        #expect(rig.stops() == 3)
        #expect(rig.ended?.confirmed == true)
        #expect(rig.backend.session(try #require(rig.sessionId))?.status == .stopped)
        await rig.clock.advance(by: .seconds(60))
        #expect(rig.stops() == 3)
    }

    @Test func stopThatTheServerSaysWasDueKeepsTheServersReason() async throws {
        let rig = ControllerRig()
        try await rig.start()
        let id = try #require(rig.sessionId)
        // The stop job got there first (the phone missed the snapshot).
        rig.backend.failListeners()
        rig.backend.end(id, reason: .timer)
        await rig.controller.stop()
        #expect(rig.ended?.reason == .timer)
        #expect(rig.ended?.confirmed == true)
    }

    @Test func doneGoesBackToIdleWithoutCancellingAPendingStop() async throws {
        let rig = ControllerRig()
        try await rig.start()
        rig.backend.stopErrors = [.offline]
        await rig.controller.stop()
        rig.controller.dismissEnded()
        #expect(rig.controller.state == .idle)
        await rig.clock.advance(by: .seconds(2))
        #expect(rig.stops() == 2)
        #expect(rig.controller.state == .idle)
    }

    // MARK: Discard

    @Test func discardDeletesTheSessionAndStopsEverything() async throws {
        let rig = ControllerRig()
        try await rig.start()
        let id = try #require(rig.sessionId)
        await rig.send()
        try await rig.controller.discard()
        #expect(rig.controller.state == .idle)
        #expect(rig.backend.calls.contains(.discard(id)))
        #expect(rig.backend.session(id) == nil)
        await ManualShareClock.settle()
        #expect(rig.location.openStreams == 0)
        let writes = rig.writes
        await rig.walk(60)
        #expect(rig.writes == writes)
    }

    @Test func discardAfterTheLinkWasOpenedCarriesOn() async throws {
        let rig = ControllerRig()
        try await rig.start()
        let id = try #require(rig.sessionId)
        rig.backend.markViewed(id)
        await #expect(throws: SharingError.linkOpened) { try await rig.controller.discard() }
        #expect(rig.live?.sessionId == id)
        #expect(rig.location.isRunningInBackground)
        await rig.walk(8)
        #expect(!rig.pings.isEmpty)
    }

    @Test func discardOfflineGoesIdleAndRetriesQuietly() async throws {
        let rig = ControllerRig()
        try await rig.start()
        let id = try #require(rig.sessionId)
        rig.backend.discardErrors = [.offline]
        try await rig.controller.discard()
        #expect(rig.controller.state == .idle)
        #expect(rig.backend.session(id) != nil)
        await rig.clock.advance(by: .seconds(2))
        #expect(rig.backend.session(id) == nil)
        #expect(rig.backend.calls.count(where: { $0 == .discard(id) }) == 2)
    }

    // MARK: The end, by the clock and by the server

    @Test func theTimerEndsItLocallyThenTheStopJobConfirms() async throws {
        let rig = ControllerRig()
        try await rig.start()
        let stopAt = try #require(rig.live?.stopAt)
        await rig.walk(15 * 60)
        let ended = try #require(rig.ended)
        #expect(ended.reason == .timer)
        #expect(ended.endedAt == stopAt)
        #expect(!ended.confirmed)
        #expect(rig.location.openStreams == 0)
        #expect(rig.backend.refusedWrites == 0)
        rig.backend.endDueSessions()
        await ManualShareClock.settle()
        #expect(rig.ended?.confirmed == true)
        #expect(rig.ended?.reason == .timer)
        #expect(rig.ended?.endedAt == stopAt)
        #expect(rig.stops() == 0)
    }

    @Test func theOneHourLimitEndsItAsTheLimit() async throws {
        let rig = ControllerRig()
        try await rig.start(ShareOptions(stop: .minutes(.minutes60), shareBack: false, precision: .precise))
        let expiresAt = try #require(rig.live?.expiresAt)
        #expect(rig.live?.countdown.endsAtLimit == true)
        await rig.walk(60 * 60)
        #expect(rig.ended?.reason == .limit)
        #expect(rig.ended?.endedAt == expiresAt)
        #expect(rig.ended?.reason.offersShareAgain == true)
    }

    @Test func withoutTheStopJobStopSessionConfirmsALocalEnd() async throws {
        let rig = ControllerRig()
        try await rig.start()
        await rig.walk(15 * 60)
        #expect(rig.ended?.confirmed == false)
        await rig.clock.advance(by: .seconds(64))
        #expect(rig.stops() == 0)
        await rig.clock.advance(by: .seconds(1))
        #expect(rig.stops() == 1)
        // stopSession on a session past stop_at reports how it ended: the timer, when it was due.
        #expect(rig.ended?.confirmed == true)
        #expect(rig.ended?.reason == .timer)
    }

    @Test func anEndOnTheServerEndsItOnThePhone() async throws {
        let rig = ControllerRig()
        try await rig.start()
        await rig.send()
        let id = try #require(rig.sessionId)
        rig.backend.end(id, reason: .call)
        await ManualShareClock.settle()
        let ended = try #require(rig.ended)
        #expect(ended.reason == .call)
        #expect(ended.confirmed)
        #expect(rig.location.openStreams == 0)
        let writes = rig.writes
        await rig.walk(60)
        #expect(rig.writes == writes)
    }

    @Test func aDeletedSessionEndsTheShare() async throws {
        let rig = ControllerRig()
        try await rig.start()
        rig.backend.delete(try #require(rig.sessionId))
        await ManualShareClock.settle()
        #expect(rig.ended?.confirmed == true)
        #expect(rig.location.openStreams == 0)
    }

    @Test func aFailedListenerListensAgain() async throws {
        let rig = ControllerRig()
        try await rig.start()
        let id = try #require(rig.sessionId)
        rig.backend.failListeners()
        await ManualShareClock.settle()
        #expect(rig.backend.listenerCount == 0)
        await rig.clock.advance(by: .seconds(2))
        #expect(rig.backend.listenerCount == 1)
        rig.backend.markViewed(id)
        await ManualShareClock.settle()
        #expect(rig.live?.firstViewedAt != nil)
    }

    @Test func theViewersSideComesFromTheListener() async throws {
        let rig = ControllerRig()
        try await rig.start()
        #expect(rig.live?.firstViewedAt == nil)
        rig.backend.markViewed(try #require(rig.sessionId))
        await ManualShareClock.settle()
        #expect(rig.live?.firstViewedAt != nil)
    }

    // MARK: The timer sheet

    @Test func aNewTimerAppliesAtOnceAndMovesTheEnd() async throws {
        let rig = ControllerRig()
        try await rig.start(ShareOptions(stop: .minutes(.minutes30), shareBack: false, precision: .precise))
        await rig.walk(60)
        try await rig.controller.changeStop(to: .minutes(.minutes15))
        let live = try #require(rig.live)
        let expected = live.startedAt.addingTimeInterval(60 + 15 * 60)
        #expect(live.stopAt.map { abs($0.timeIntervalSince(expected)) < 0.01 } == true)
        #expect(rig.backend.session(live.sessionId)?.stopAt == live.stopAt)
        await rig.walk(15 * 60)
        #expect(rig.ended?.reason == .timer)
    }

    @Test func aTimerThatFailsToSaveRollsBack() async throws {
        let rig = ControllerRig()
        try await rig.start()
        let before = try #require(rig.live)
        rig.backend.nextFieldWriteError = .offline
        await #expect(throws: SharingError.offline) { try await rig.controller.changeStop(to: .limit) }
        #expect(rig.live?.stopRule == before.stopRule)
        #expect(rig.live?.stopAt == before.stopAt)
        // The old timer still ends it.
        await rig.walk(15 * 60)
        #expect(rig.ended?.reason == .timer)
    }

    @Test func theLimitChoiceRunsToTheHour() async throws {
        let rig = ControllerRig()
        try await rig.start()
        try await rig.controller.changeStop(to: .limit)
        #expect(rig.live?.stopRule == .limit)
        #expect(rig.live?.stopAt == rig.live?.expiresAt)
        await rig.walk(30 * 60)
        #expect(rig.live != nil)
    }

    @Test func aManualShareCantFollowTheCall() async throws {
        let rig = ControllerRig()
        try await rig.start()
        await #expect(throws: SharingError.rejected(field: "stop_rule")) { try await rig.controller.changeStop(to: .call) }
    }

    // MARK: Precision

    @Test func approximateAppliesFromTheNextPing() async throws {
        let rig = ControllerRig()
        try await rig.start()
        await rig.send()
        try await rig.controller.changePrecision(to: .approximate)
        #expect(rig.live?.precision == .precise)
        #expect(rig.live?.precisionNext == .approximate)
        #expect(rig.live?.chosenPrecision == .approximate)
        #expect(rig.backend.session(try #require(rig.sessionId))?.precisionNext == .approximate)
        await rig.walk(4)
        #expect(rig.pings.last?.accuracyM == 500)
        #expect(rig.live?.precision == .approximate)
        #expect(rig.live?.precisionNext == nil)
        #expect(rig.live?.lastPoint?.precision == .approximate)
    }

    @Test func approximateStaysEvenIfItsWriteFails() async throws {
        let rig = ControllerRig()
        try await rig.start()
        await rig.send()
        rig.backend.nextFieldWriteError = .offline
        await #expect(throws: SharingError.offline) { try await rig.controller.changePrecision(to: .approximate) }
        #expect(rig.live?.chosenPrecision == .approximate)
        await rig.walk(4)
        #expect(rig.pings.last?.accuracyM == 500)
    }

    @Test func preciseRollsBackIfItsWriteFails() async throws {
        let rig = ControllerRig()
        try await rig.start(ShareOptions(stop: .minutes(.minutes15), shareBack: false, precision: .approximate))
        await rig.send()
        rig.backend.nextFieldWriteError = .offline
        await #expect(throws: SharingError.offline) { try await rig.controller.changePrecision(to: .precise) }
        #expect(rig.live?.chosenPrecision == .approximate)
        await rig.walk(4)
        #expect(rig.pings.allSatisfy { $0.accuracyM >= 500 })
    }

    @Test func noSignalAndOfflineReachTheLiveShare() async throws {
        let rig = ControllerRig()
        try await rig.start()
        await rig.send()
        await rig.clock.advance(by: .seconds(30))
        guard case .noSignal = rig.live?.upload else {
            Issue.record("expected no signal, got \(String(describing: rig.live?.upload))")
            return
        }
        rig.backend.writeErrors = [.offline]
        await rig.send()
        #expect(rig.live?.upload == .offline)
    }
}
