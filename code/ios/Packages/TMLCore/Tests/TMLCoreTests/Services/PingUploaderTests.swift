import Foundation
import Testing
@testable import TMLCore

/// A session on the fake backend and an uploader for it, on a clock the test moves.
@MainActor
final class UploaderRig {
    let clock = ManualShareClock()
    let backend: FakeSessionBackend
    let battery = FixedBattery(percent: 80)
    let sessionId: String
    let startedAt: Date
    let expiresAt: Date
    let uploader: PingUploader
    private(set) var ends: [PingUploader.End] = []

    /// - Parameter serverOffset: the server's clock minus the phone's.
    init(serverOffset: TimeInterval = 0, stop: TMLStopMinutes = .minutes30, precision: TMLPrecision = .precise) async throws {
        backend = FakeSessionBackend(clock: clock, serverOffset: serverOffset)
        let response = try await backend.createSession(
            TMLCreateSessionRequest(stopRule: .minutes, stopMinutes: stop, shareBackAllowed: false, precision: precision))
        sessionId = response.sessionId
        let session = try #require(backend.session(sessionId))
        startedAt = session.startedAt
        expiresAt = session.expiresAt
        uploader = PingUploader(sessionId: sessionId, backend: backend, clock: clock,
                                serverClock: ServerClock(offset: serverOffset), battery: battery, precision: precision,
                                startedAt: startedAt, endsAt: session.stopAt ?? session.expiresAt)
        uploader.onEnd = { [weak self] in self?.ends.append($0) }
        uploader.start()
        await ManualShareClock.settle()
    }

    /// A fix taken `age` seconds ago by the phone's clock.
    func fix(_ lat: Double = 37.7850, _ lng: Double = -122.4025, accuracy: Double = 8, age: TimeInterval = 0,
             speed: Double? = 1.4) -> LocationFix {
        LocationFix(latitude: lat, longitude: lng, horizontalAccuracy: accuracy, timestamp: clock.now.addingTimeInterval(-age),
                    speed: speed)
    }

    func send(_ fix: LocationFix, stationary: Bool = false, limited: Bool = false) async {
        uploader.receive(LocationUpdate(fix: fix, isStationary: stationary, isAccuracyLimited: limited))
        await ManualShareClock.settle()
    }

    func advance(_ seconds: Double) async { await clock.advance(by: .milliseconds(Int64(seconds * 1000))) }

    /// Every ping write sent, accepted or not.
    var pingWrites: [PingWrite] {
        backend.calls.compactMap { if case .ping(_, let write) = $0 { write } else { nil } }
    }

    var checkIns: [Double] {
        backend.calls.compactMap { if case .checkIn(_, let interval) = $0 { interval } else { nil } }
    }

    var accepted: [TMLPing] { backend.acceptedPings[sessionId] ?? [] }
}

@MainActor
@Suite("Ping uploader")
struct PingUploaderTests {
    @Test func theFirstFixIsSentAtOnceWithItsCheckInAndLastFixAt() async throws {
        let rig = try await UploaderRig()
        #expect(rig.uploader.status == .waitingForFix)
        let fix = rig.fix()
        await rig.send(fix)
        #expect(rig.accepted == [TMLPing(lat: fix.latitude, lng: fix.longitude, accuracyM: 8, recordedAt: fix.timestamp)])
        let session = try #require(rig.backend.session(rig.sessionId))
        #expect(session.lastFixAt == fix.timestamp)
        #expect(session.pingIntervalS == 4)
        #expect(rig.uploader.status == .live)
        #expect(rig.uploader.lastSent == SharedPoint(latitude: fix.latitude, longitude: fix.longitude, accuracyM: 8,
                                                     recordedAt: fix.timestamp, precision: .precise))
    }

    @Test func fixesBetweenPingsCoalesceIntoTheNewest() async throws {
        let rig = try await UploaderRig()
        await rig.send(rig.fix())
        // Four fixes in the next 3.5 s: none goes until the 4 s interval is up, then only the newest.
        for step in 1...4 {
            await rig.advance(0.875)
            await rig.send(rig.fix(37.7850 + Double(step) * 0.0001))
        }
        #expect(rig.pingWrites.count == 1)
        await rig.advance(0.5)
        #expect(rig.pingWrites.count == 2)
        #expect(abs((rig.accepted.last?.lat ?? 0) - 37.7854) < 1e-9)
    }

    @Test func theIntervalFollowsSpeedAndBattery() async throws {
        let rig = try await UploaderRig()
        await rig.send(rig.fix(speed: 12))
        #expect(rig.uploader.interval == 3)
        rig.battery.percent = 15
        await rig.advance(3)
        await rig.send(rig.fix(speed: 12))
        #expect(rig.uploader.interval == 15)
        #expect(rig.backend.session(rig.sessionId)?.pingIntervalS == 15)
        rig.battery.percent = 5
        await rig.advance(15)
        await rig.send(rig.fix(speed: 12))
        #expect(rig.uploader.interval == 60)
        #expect(rig.backend.session(rig.sessionId)?.pingIntervalS == 60)
        // At 60 s a ping, but a check-in still every 30 s.
        let pings = rig.pingWrites.count
        await rig.advance(31)
        await rig.send(rig.fix(speed: 12))
        #expect(rig.pingWrites.count == pings)
        #expect(rig.checkIns.count == 1)
    }

    @Test func approximatePingsAreRoundedBeforeTheyLeave() async throws {
        let rig = try await UploaderRig(precision: .approximate)
        let fix = rig.fix(37.78512, -122.40233, accuracy: 12)
        await rig.send(fix)
        let ping = try #require(rig.accepted.first)
        let rounded = ApproximateLocation.round(latitude: fix.latitude, longitude: fix.longitude)
        #expect(ping.lat == rounded.latitude)
        #expect(ping.lng == rounded.longitude)
        #expect(ping.accuracyM == 500)
        #expect(rig.backend.refusedWrites == 0)
    }

    @Test func aPrecisionChangeAppliesFromTheNextPing() async throws {
        let rig = try await UploaderRig()
        await rig.send(rig.fix())
        rig.uploader.setPrecision(.approximate)
        #expect(rig.uploader.precision == .precise)
        #expect(rig.uploader.pendingPrecision == .approximate)
        await rig.advance(4)
        await rig.send(rig.fix())
        #expect(rig.accepted.last?.accuracyM == 500)
        #expect(rig.backend.session(rig.sessionId)?.precision == .approximate)
        #expect(rig.uploader.precision == .approximate)
        #expect(rig.uploader.pendingPrecision == nil)
        rig.uploader.setPrecision(.precise)
        await rig.advance(4)
        await rig.send(rig.fix())
        #expect(rig.accepted.last?.accuracyM == 8)
        #expect(rig.backend.session(rig.sessionId)?.precision == .precise)
        #expect(rig.backend.refusedWrites == 0)
    }

    @Test func withoutPreciseLocationEveryPingIsApproximate() async throws {
        let rig = try await UploaderRig()
        // Reduced accuracy: kilometers off, which would otherwise be no fix at all.
        await rig.send(rig.fix(accuracy: 3_000), limited: true)
        let ping = try #require(rig.accepted.first)
        #expect(ping.accuracyM == 3_000)
        #expect(rig.backend.session(rig.sessionId)?.precision == .approximate)
        #expect(rig.uploader.pendingPrecision == nil)
        // Precise Location back on: precise again from the next ping.
        await rig.advance(5)
        await rig.send(rig.fix())
        #expect(rig.backend.session(rig.sessionId)?.precision == .precise)
    }

    @Test func roughOutOfOrderAndStaleFixesAreDropped() async throws {
        let rig = try await UploaderRig()
        await rig.send(rig.fix(accuracy: 150))
        await rig.send(rig.fix(accuracy: -1))
        await rig.send(rig.fix(accuracy: 200_000))
        await rig.send(LocationFix(latitude: 91, longitude: 0, horizontalAccuracy: 5, timestamp: rig.clock.now))
        #expect(rig.pingWrites.isEmpty)
        await rig.send(rig.fix())
        let sent = try #require(rig.accepted.first)
        // Older than the one sent: dropped.
        await rig.advance(4)
        await rig.send(rig.fix(age: 6))
        #expect(rig.pingWrites.count == 1)
        // A fix that waits past 15 s for its turn (a 60 s interval) is dropped too.
        rig.battery.percent = 5
        await rig.advance(1)
        await rig.send(rig.fix())
        rig.battery.percent = 80
        await rig.advance(60)
        #expect(rig.accepted.allSatisfy { $0.recordedAt >= sent.recordedAt })
        let late = rig.pingWrites.dropFirst(2)
        #expect(late.isEmpty)
    }

    @Test func pingsAreNeverUnderTwoSecondsApartEvenWhenFixesBunchUp() async throws {
        let rig = try await UploaderRig()
        await rig.send(rig.fix(speed: 12))
        await rig.advance(3)
        // The newest fix at the next turn was taken 1.5 s after the last one sent: too close for
        // the rules, so it waits for a newer one.
        await rig.send(LocationFix(latitude: 37.786, longitude: -122.40, horizontalAccuracy: 8,
                                   timestamp: try #require(rig.accepted.first).recordedAt.addingTimeInterval(1.5), speed: 12))
        #expect(rig.pingWrites.count == 1)
        await rig.send(rig.fix(37.787, speed: 12))
        #expect(rig.pingWrites.count == 2)
        let times = rig.accepted.map(\.recordedAt)
        for (a, b) in zip(times, times.dropFirst()) {
            #expect(b.timeIntervalSince(a) >= TimeInterval(TMLSchemaConstants.minPingSpacingSeconds))
        }
        #expect(rig.backend.refusedWrites == 0)
    }

    @Test func withoutAFixItChecksInEveryThirtySecondsAndSaysNoSignal() async throws {
        let rig = try await UploaderRig()
        await rig.advance(29)
        #expect(rig.checkIns.isEmpty)
        #expect(rig.uploader.status == .waitingForFix)
        await rig.advance(1)
        #expect(rig.checkIns.count == 1)
        #expect(rig.uploader.status == .noSignal(lastFixAt: nil))
        await rig.advance(30)
        #expect(rig.checkIns.count == 2)
        #expect(rig.backend.acceptedCheckIns[rig.sessionId] == 2)
        // A fix brings it back, and then losing it says No signal with the last time.
        await rig.send(rig.fix())
        #expect(rig.uploader.status == .live)
        let sentAt = rig.uploader.lastSentAt
        await rig.advance(30)
        #expect(rig.uploader.status == .noSignal(lastFixAt: sentAt))
    }

    @Test func aStationaryPhoneKeepsPingingItsLastPositionTimedNow() async throws {
        let rig = try await UploaderRig()
        let fix = rig.fix()
        await rig.send(fix)
        rig.uploader.receive(LocationUpdate(isStationary: true))
        await ManualShareClock.settle()
        // The next turn, 4 s after the first ping: the same place, timed now; then every 5 s (still).
        await rig.advance(4)
        #expect(rig.accepted.count == 2)
        #expect(rig.accepted[1].lat == fix.latitude)
        #expect(rig.accepted[1].recordedAt == rig.clock.now)
        await rig.advance(60)
        // Still there: live, no gaps over 5 s.
        #expect(rig.uploader.status == .live)
        #expect(rig.accepted.count >= 13)
    }

    @Test func offlineItBacksOffAndRetriesWithTheNewestFix() async throws {
        let rig = try await UploaderRig()
        rig.backend.writeErrors = [.offline, .offline]
        await rig.send(rig.fix())
        #expect(rig.uploader.status == .offline)
        #expect(rig.pingWrites.count == 1)
        // Retries wait for the backoff (2 s, then 4 s) and the 4 s interval, whichever is later.
        await rig.advance(3.9)
        #expect(rig.pingWrites.count == 1)
        await rig.send(rig.fix(37.786))
        await rig.advance(0.2)
        #expect(rig.pingWrites.count == 2)
        #expect(rig.pingWrites[1].ping.lat == 37.786)
        await rig.advance(3.9)
        #expect(rig.pingWrites.count == 2)
        await rig.advance(0.2)
        #expect(rig.pingWrites.count == 3)
        #expect(rig.accepted.count == 1)
        #expect(rig.uploader.status == .live)
    }

    @Test func theBackoffGrowsToThirtySecondsAndNothingElseGoesMeanwhile() async throws {
        let rig = try await UploaderRig()
        rig.backend.writeErrors = Array(repeating: .offline, count: 6)
        let start = rig.clock.now
        var attempts: [TimeInterval] = []
        var seen = 0
        await rig.send(rig.fix())
        for _ in 0..<100 {
            if rig.backend.calls.count > seen {
                attempts.append(rig.clock.now.timeIntervalSince(start).rounded())
                seen = rig.backend.calls.count
            }
            await rig.advance(1)
            await rig.send(rig.fix())
        }
        // Failures at 0, 4, 8, 16, 32 and 62 s; the seventh try, at 92 s, lands. Never a check-in.
        #expect(Array(attempts.prefix(7)) == [0, 4, 8, 16, 32, 62, 92])
        // Then the normal cadence again.
        #expect(attempts.dropFirst(7).first == 96)
        #expect(rig.checkIns.isEmpty)
        #expect(rig.accepted.count >= 1)
        #expect(rig.uploader.status == .live)
    }

    @Test func anUnansweredWriteHoldsEverythingElseBackAndShowsOffline() async throws {
        let rig = try await UploaderRig()
        rig.backend.holdsWrites = true
        await rig.send(rig.fix())
        // A minute of fixes while the first write waits: nothing else is sent.
        for _ in 0..<60 {
            await rig.advance(1)
            await rig.send(rig.fix())
        }
        #expect(rig.pingWrites.count == 1)
        #expect(rig.checkIns.isEmpty)
        #expect(rig.uploader.status == .offline)
        // Back online: the held write lands, then just the newest fix, not the backlog.
        rig.backend.releaseWrites()
        await ManualShareClock.settle()
        #expect(rig.pingWrites.count == 2)
        #expect(rig.accepted.count == 2)
        #expect(rig.uploader.status == .live)
    }

    @Test func aRetryOfABatchThatHadLandedCountsAsWritten() async throws {
        let rig = try await UploaderRig()
        rig.backend.landsThenFails = 1
        let fix = rig.fix()
        await rig.send(fix)
        #expect(rig.accepted.count == 1)
        #expect(rig.uploader.status == .offline)
        // The same batch again (after the 4 s interval): refused, since last_fix_at already has it.
        await rig.advance(4)
        try #require(rig.pingWrites.count == 2)
        #expect(rig.pingWrites[1] == rig.pingWrites[0])
        #expect(rig.backend.refusedWrites == 1)
        #expect(rig.backend.calls.contains(.fetch(rig.sessionId)))
        #expect(rig.ends.isEmpty)
        #expect(!rig.uploader.isStopped)
        #expect(rig.uploader.status == .live)
        #expect(rig.uploader.lastSentAt == fix.timestamp)
        // And sharing carries on.
        await rig.advance(4)
        await rig.send(rig.fix())
        #expect(rig.accepted.count == 2)
    }

    @Test func aRefusalTheSessionCantExplainYetIsRetried() async throws {
        let rig = try await UploaderRig()
        rig.backend.landsThenFails = 1
        rig.backend.fetchErrors = [.offline]
        await rig.send(rig.fix())
        await rig.advance(4)
        #expect(rig.ends.isEmpty)
        #expect(rig.uploader.status == .offline)
        // The retry is refused again, and this time the session can be read.
        await rig.advance(4)
        #expect(rig.ends.isEmpty)
        #expect(rig.uploader.status == .live)
    }

    @Test func aFailedPrecisePingIsNeverRetriedAfterSwitchingToApproximate() async throws {
        let rig = try await UploaderRig()
        rig.backend.writeErrors = [.offline]
        await rig.send(rig.fix())
        rig.uploader.setPrecision(.approximate)
        await rig.advance(5)
        #expect(rig.pingWrites.count == 1)
        await rig.send(rig.fix())
        #expect(rig.pingWrites.last?.precision == .approximate)
        #expect(rig.accepted.allSatisfy { $0.accuracyM >= 500 })
    }

    @Test func stopIsInstantAndNothingIsWrittenAfter() async throws {
        let rig = try await UploaderRig()
        rig.backend.holdsWrites = true
        await rig.send(rig.fix())
        rig.uploader.stop()
        rig.backend.releaseWrites()
        await ManualShareClock.settle()
        let writes = rig.backend.calls.count
        for _ in 0..<5 {
            await rig.send(rig.fix())
            await rig.advance(30)
        }
        #expect(rig.backend.calls.count == writes)
        #expect(rig.ends.isEmpty)
        #expect(rig.clock.sleepers == 0)
    }

    @Test func atStopAtByTheServersClockItEndsAndNeverWritesAgain() async throws {
        // The server is 3 minutes ahead of the phone: the phone's clock alone would write 3 minutes too long.
        let rig = try await UploaderRig(serverOffset: 180, stop: .minutes15)
        await rig.send(rig.fix())
        #expect(rig.backend.refusedWrites == 0)
        for _ in 0..<300 where rig.ends.isEmpty {
            await rig.advance(5)
            await rig.send(rig.fix())
        }
        #expect(rig.ends == [.due])
        let endedAt = rig.clock.now.addingTimeInterval(180)
        #expect(endedAt >= rig.startedAt.addingTimeInterval(15 * 60))
        #expect(endedAt < rig.startedAt.addingTimeInterval(15 * 60 + 5))
        #expect(rig.backend.refusedWrites == 0)
        let writes = rig.backend.calls.count
        await rig.send(rig.fix())
        await rig.advance(60)
        #expect(rig.backend.calls.count == writes)
    }

    @Test func aPhoneClockAheadOfTheServerStillWritesTimesTheRulesAccept() async throws {
        let rig = try await UploaderRig(serverOffset: -300)
        await rig.send(rig.fix())
        await rig.advance(4)
        await rig.send(rig.fix())
        #expect(rig.accepted.count == 2)
        #expect(rig.backend.refusedWrites == 0)
        #expect(rig.accepted.allSatisfy { $0.recordedAt <= rig.backend.serverNow })
    }

    @Test func whenTheServerEndsTheSessionTheUploaderStops() async throws {
        let rig = try await UploaderRig()
        await rig.send(rig.fix())
        rig.backend.end(rig.sessionId, reason: .stopped)
        await rig.advance(4)
        await rig.send(rig.fix())
        #expect(rig.ends == [.refused(.sessionEnded)])
        #expect(rig.uploader.isStopped)
        let writes = rig.pingWrites.count
        await rig.advance(30)
        await rig.send(rig.fix())
        #expect(rig.pingWrites.count == writes)
    }

    @Test func aSignInThatEndedStopsIt() async throws {
        let rig = try await UploaderRig()
        rig.backend.writeErrors = [.signInEnded]
        await rig.send(rig.fix())
        #expect(rig.ends == [.refused(.signInEnded)])
    }

    @Test func theTimerChangingMovesTheEnd() async throws {
        let rig = try await UploaderRig(stop: .minutes15)
        rig.uploader.setEndsAt(rig.startedAt.addingTimeInterval(60))
        await rig.advance(59)
        #expect(rig.ends.isEmpty)
        await rig.advance(1)
        #expect(rig.ends == [.due])
    }
}
