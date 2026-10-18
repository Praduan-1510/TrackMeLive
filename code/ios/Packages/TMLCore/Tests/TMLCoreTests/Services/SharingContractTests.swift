import Foundation
import Testing
@testable import TMLCore

private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
private func at(minutes: Double) -> Date { t0.addingTimeInterval(minutes * 60) }

@Suite("Server clock")
struct ServerClockTests {
    @Test func theOffsetIsTheServerStampAgainstTheCallsMidpoint() {
        // Sent at 0 s, answered at 2 s: the server stamped 100 s, so it's 99 s ahead.
        let clock = ServerClock(serverTime: t0.addingTimeInterval(100), sent: t0, received: t0.addingTimeInterval(2))
        #expect(clock.offset == 99)
        #expect(clock.server(t0) == t0.addingTimeInterval(99))
        #expect(clock.device(t0.addingTimeInterval(99)) == t0)
    }

    @Test func aPhoneAheadOfTheServerGetsANegativeOffset() {
        let clock = ServerClock(serverTime: t0, sent: t0.addingTimeInterval(300), received: t0.addingTimeInterval(300))
        #expect(clock.offset == -300)
    }
}

@Suite("Countdown and the timer sheet (FSD §4 Stop rule, Auto-expiry, 1-hour warning)")
struct ShareCountdownTests {
    private let expiresAt = at(minutes: 60)

    @Test func aTimerEndsAtStopAtAndTheLimitOrCallAtExpiresAt() {
        let timer = ShareCountdown(expiresAt: expiresAt, stopRule: .minutes, stopAt: at(minutes: 30))
        #expect(timer.endsAt == at(minutes: 30))
        #expect(!timer.endsAtLimit)
        #expect(timer.dueReason == .timer)
        let limit = ShareCountdown(expiresAt: expiresAt, stopRule: .limit, stopAt: expiresAt)
        #expect(limit.endsAt == expiresAt)
        #expect(limit.dueReason == .limit)
        let call = ShareCountdown(expiresAt: expiresAt, stopRule: .call, stopAt: nil)
        #expect(call.endsAt == expiresAt)
        #expect(call.dueReason == .limit)
        // In 1 hour from the start is stop_at == expires_at: the limit (x-decisions Q-END-REASON-LIMIT).
        let hour = ShareCountdown(expiresAt: expiresAt, stopRule: .minutes, stopAt: expiresAt)
        #expect(hour.dueReason == .limit)
    }

    @Test func aTimerIsNeverLaterThanTheLimit() {
        let late = ShareCountdown(expiresAt: expiresAt, stopRule: .minutes, stopAt: at(minutes: 75))
        #expect(late.endsAt == expiresAt)
    }

    @Test func remainingAndDueRunOnTheGivenClock() {
        let timer = ShareCountdown(expiresAt: expiresAt, stopRule: .minutes, stopAt: at(minutes: 15))
        #expect(timer.remaining(at: at(minutes: 10)) == 300)
        #expect(timer.remaining(at: at(minutes: 20)) == 0)
        #expect(!timer.isDue(at: at(minutes: 15).addingTimeInterval(-0.001)))
        #expect(timer.isDue(at: at(minutes: 15)))
    }

    @Test func theLimitWarningShowsFromFiveMinutesBeforeTheLimitOnly() {
        let limit = ShareCountdown(expiresAt: expiresAt, stopRule: .limit, stopAt: expiresAt)
        #expect(!limit.showsLimitWarning(at: at(minutes: 54.99)))
        #expect(limit.showsLimitWarning(at: at(minutes: 55)))
        #expect(limit.showsLimitWarning(at: at(minutes: 59.9)))
        #expect(!limit.showsLimitWarning(at: at(minutes: 60)))
        // A timer that ends first has no limit warning.
        let timer = ShareCountdown(expiresAt: expiresAt, stopRule: .minutes, stopAt: at(minutes: 58))
        #expect(!timer.showsLimitWarning(at: at(minutes: 57)))
    }

    @Test func theSheetOffersOnlyTimersThatEndBeforeTheLimit() {
        let countdown = ShareCountdown(expiresAt: expiresAt, stopRule: .minutes, stopAt: at(minutes: 30))
        #expect(countdown.choices(at: at(minutes: 0.5), callAvailable: false)
            == [.minutes(.minutes15), .minutes(.minutes30), .limit])
        #expect(countdown.choices(at: at(minutes: 40), callAvailable: false) == [.minutes(.minutes15), .limit])
        #expect(countdown.choices(at: at(minutes: 45), callAvailable: false) == [.limit])
        #expect(countdown.choices(at: at(minutes: 10), callAvailable: true).first == .call)
    }

    @Test func changesSetStopAtFromNowCappedAtTheLimit() {
        let countdown = ShareCountdown(expiresAt: expiresAt, stopRule: .minutes, stopAt: at(minutes: 30))
        #expect(countdown.change(to: .minutes(.minutes15), at: at(minutes: 10))
            == StopRuleChange(stopRule: .minutes, stopMinutes: .minutes15, stopAt: at(minutes: 25)))
        #expect(countdown.change(to: .minutes(.minutes30), at: at(minutes: 50))
            == StopRuleChange(stopRule: .minutes, stopMinutes: .minutes30, stopAt: expiresAt))
        #expect(countdown.change(to: .limit, at: at(minutes: 50)) == StopRuleChange(stopRule: .limit, stopAt: expiresAt))
        #expect(countdown.change(to: .call, at: at(minutes: 50)) == StopRuleChange(stopRule: .call))
        #expect(countdown.applying(countdown.change(to: .limit, at: at(minutes: 50))).endsAt == expiresAt)
    }
}

@Suite("Share options and the createSession payload")
struct ShareOptionsTests {
    @Test func aManualShareCantFollowACallOrShareBack() {
        let request = ShareOptions(stop: .call, shareBack: true, precision: .precise).request
        #expect(request.stopRule == .minutes)
        #expect(request.stopMinutes == .minutes30)
        #expect(request.callId == nil)
        #expect(!request.shareBackAllowed)
    }

    @Test func aCallShareKeepsItsRule() {
        let request = ShareOptions(stop: .call, callId: "C-1", shareBack: true, precision: .approximate).request
        #expect(request.stopRule == .call)
        #expect(request.stopMinutes == nil)
        #expect(request.callId == "C-1")
        #expect(request.shareBackAllowed)
        #expect(request.precision == .approximate)
    }

    @Test func theLimitStartsAsInOneHour() {
        let request = ShareOptions(stop: .limit, shareBack: false, precision: .precise).request
        #expect(request.stopRule == .minutes)
        #expect(request.stopMinutes == .minutes60)
    }

    @Test func theNameIsTidiedAndAnEmptyOneIsNone() {
        #expect(ShareOptions(viewerName: "  Mom  ", stop: .minutes(.minutes15), shareBack: false, precision: .precise)
            .request.viewerName == "Mom")
        #expect(ShareOptions(viewerName: "   ", stop: .minutes(.minutes15), shareBack: false, precision: .precise)
            .request.viewerName == nil)
        #expect(ShareOptions(stop: .minutes(.minutes15), shareBack: false, precision: .precise).request.viewerName == nil)
    }

    @Test func thePayloadHasTheSchemasKeysWithNulls() throws {
        let payload = try ShareOptions(viewerName: "Mom", stop: .minutes(.minutes15), shareBack: false, precision: .precise)
            .request.callablePayload()
        #expect(payload["stop_rule"] as? String == "minutes")
        #expect(payload["stop_minutes"] as? Int == 15)
        #expect(payload["call_id"] is NSNull)
        #expect(payload["share_back_allowed"] as? Bool == false)
        #expect(payload["precision"] as? String == "precise")
        #expect(payload["viewer_name"] as? String == "Mom")
    }

    @Test func theResponsesDecodeFromTheCallablesJSON() throws {
        let created = try TMLCreateSessionResponse.decode(Data("""
            {"session_id":"s1","link_token":"abc","link_url":"https://trackme.live/s/abc","started_at":1800000000000,"expires_at":1800003600000}
            """.utf8))
        #expect(created.sessionId == "s1")
        #expect(SharingWire.date(ms: created.expiresAt) == at(minutes: 60))
        let stopped = try TMLStopSessionResponse.decode(Data("""
            {"session_id":"s1","ended_at":1800000600000,"end_reason":"timer"}
            """.utf8))
        #expect(stopped.endReason == .timer)
        #expect(try TMLStopSessionRequest(sessionId: "s1").callablePayload()["session_id"] as? String == "s1")
        #expect(try TMLDiscardSessionRequest(sessionId: "s1").callablePayload()["session_id"] as? String == "s1")
    }
}

@Suite("Sharing errors")
struct SharingErrorTests {
    typealias Code = SharingError.Code

    @Test func callableCodesMapToWhatTheAppCanSay() {
        #expect(SharingError.callable(code: Code.unauthenticated, details: nil) == .signInEnded)
        #expect(SharingError.callable(code: Code.permissionDenied, details: nil) == .notSignedIn)
        #expect(SharingError.callable(code: Code.unavailable, details: nil) == .offline)
        #expect(SharingError.callable(code: Code.deadlineExceeded, details: nil) == .offline)
        #expect(SharingError.callable(code: Code.alreadyExists, details: ["reason": "active_session", "session_id": "s9"])
            == .alreadySharing(sessionId: "s9"))
        #expect(SharingError.callable(code: Code.notFound, details: nil) == .sessionEnded)
        #expect(SharingError.callable(code: Code.failedPrecondition, details: ["reason": "link_opened"]) == .linkOpened)
        #expect(SharingError.callable(code: Code.failedPrecondition, details: ["reason": "no_profile"]) == .noProfile)
        #expect(SharingError.callable(code: Code.failedPrecondition, details: ["reason": "session_ended"]) == .sessionEnded)
        #expect(SharingError.callable(code: Code.failedPrecondition, details: nil) == .failed)
        #expect(SharingError.callable(code: Code.invalidArgument, details: ["errors": [["field": "stop_minutes", "message": "x"]]])
            == .rejected(field: "stop_minutes"))
        #expect(SharingError.callable(code: 13, details: nil) == .failed)
    }

    @Test func aRefusedWriteMeansTheSessionIsOver() {
        #expect(SharingError.write(code: Code.permissionDenied) == .sessionEnded)
        #expect(SharingError.write(code: Code.notFound) == .sessionEnded)
        #expect(SharingError.write(code: Code.unauthenticated) == .signInEnded)
        #expect(SharingError.write(code: Code.unavailable) == .offline)
        #expect(SharingError.write(code: Code.aborted) == .offline)
        #expect(SharingError.write(code: 13) == .failed)
    }

    @Test func onlyOfflineAndUnknownFailuresAreRetried() {
        #expect(SharingError.offline.isRetryable)
        #expect(SharingError.failed.isRetryable)
        for error in [SharingError.sessionEnded, .signInEnded, .notSignedIn, .linkOpened, .alreadySharing(sessionId: nil)] {
            #expect(!error.isRetryable)
        }
    }

    @Test func everyErrorHasALine() {
        let all: [SharingError] = [.notSignedIn, .signInEnded, .offline, .alreadySharing(sessionId: nil), .sessionEnded,
                                   .linkOpened, .locationOff, .noProfile, .rejected(field: nil), .failed]
        for error in all { #expect(!error.message.isEmpty) }
    }
}

@Suite("Location authorization (FSD §8)")
struct LocationAuthorizationTests {
    @Test func neverAskedExplainsFirstThenAsks() {
        #expect(LocationAuthorization.notAsked.gate(wanting: .precise) == .explain)
        #expect(LocationAuthorization(status: .notDetermined, hasAsked: true).gate(wanting: .precise) == .ask)
    }

    @Test func deniedOrServicesOffGoToSettingsAndRestrictedHasNoWayOut() {
        #expect(LocationAuthorization(status: .denied, hasAsked: true).gate(wanting: .precise)
            == .turnOnInSettings(servicesOff: false))
        #expect(LocationAuthorization(status: .whenInUse, servicesEnabled: false).gate(wanting: .precise)
            == .turnOnInSettings(servicesOff: true))
        #expect(LocationAuthorization(status: .restricted).gate(wanting: .precise) == .restricted)
        #expect(LocationAuthorization(status: .restricted, servicesEnabled: false).gate(wanting: .precise) == .restricted)
    }

    @Test func allowedSharesAtTheWantedPrecisionOrApproximateWithoutPreciseLocation() {
        #expect(LocationAuthorization(status: .whenInUse).gate(wanting: .precise) == .ready(precision: .precise, offerPrecise: false))
        #expect(LocationAuthorization(status: .always).gate(wanting: .approximate)
            == .ready(precision: .approximate, offerPrecise: false))
        #expect(LocationAuthorization(status: .whenInUse, precise: false).gate(wanting: .precise)
            == .ready(precision: .approximate, offerPrecise: true))
        #expect(LocationAuthorization(status: .whenInUse, precise: false).gate(wanting: .approximate)
            == .ready(precision: .approximate, offerPrecise: false))
    }

    @Test func settingsShowsTheSameStates() {
        #expect(LocationAuthorization.notAsked.permission == .notSet)
        #expect(LocationAuthorization(status: .notDetermined, hasAsked: true).permission == .askNextTime)
        #expect(LocationAuthorization(status: .whenInUse, precise: false).permission == .whileUsing(precise: false))
        #expect(LocationAuthorization(status: .always).permission == .always(precise: true))
        #expect(LocationAuthorization(status: .denied).permission == .off)
        #expect(LocationAuthorization(status: .restricted).permission == .off)
        #expect(LocationAuthorization(status: .whenInUse, servicesEnabled: false).permission == .off)
        #expect(LocationAuthorization(status: .whenInUse).isAllowed)
        #expect(!LocationAuthorization(status: .whenInUse, servicesEnabled: false).isAllowed)
    }

    @MainActor
    @Test func theFakeAnswersThePromptOnceAndThePreciseRequest() async {
        let access = FakeLocationAccess(answer: .whenInUse, grantsPrecise: false, grantsPreciseOnce: true)
        let answer = await access.requestWhenInUse()
        #expect(answer == LocationAuthorization(status: .whenInUse, precise: false, hasAsked: true))
        // iOS doesn't ask twice.
        access.answer = .denied
        #expect(await access.requestWhenInUse().status == .whenInUse)
        #expect(await access.requestPreciseOnce().precise)
        #expect(access.requests == ["whenInUse", "whenInUse", "preciseOnce"])
        #expect(access.settingsURL != nil)
    }
}

@Suite("Ended states (prototype viewEnded)")
struct ShareEndTests {
    @Test func eachServerReasonHasTheProtoypesWords() {
        #expect(ShareEndReason(.limit).title == "Sharing stopped after 1 hour")
        #expect(ShareEndReason(.limit).offersShareAgain)
        for reason in [TMLEndReason.stopped, .call, .timer] {
            #expect(ShareEndReason(reason).title == "Sharing ended")
            #expect(!ShareEndReason(reason).offersShareAgain)
            #expect(ShareEndReason(reason).endReason == reason)
        }
        #expect(ShareEndReason.stopped.message(endedTime: "9:52 pm") == "You stopped sharing at 9:52 pm.")
        #expect(ShareEndReason.timer.message(endedTime: "x") == "Your timer ran out, so sharing stopped.")
        #expect(ShareEndReason.call.message(endedTime: "x") == "Your call ended, so sharing stopped.")
        #expect(ShareEndReason.limit.message(endedTime: "x").hasPrefix("That\u{2019}s the longest a link can run."))
    }

    @Test func pointsAreDeletedADayAfterTheEnd() {
        let ended = EndedShare(sessionId: "s", reason: .timer, startedAt: t0, endedAt: at(minutes: 30), confirmed: true)
        #expect(ended.duration == 1800)
        #expect(ended.pointsDeletedBy == at(minutes: 30 + 24 * 60))
    }
}
