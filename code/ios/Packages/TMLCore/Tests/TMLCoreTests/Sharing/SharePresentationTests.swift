import Foundation
import Testing
@testable import TMLCore

@Suite("Stop choices on the share screen")
struct StopChoicePresentationTests {
    @Test func theCallIsTheDefaultOnlyDuringACall() {
        #expect(StopChoice(defaultStop: .call, onCall: true) == .call)
        #expect(StopChoice(defaultStop: .call, onCall: false) == .minutes(.minutes30))
    }

    @Test(arguments: [(TMLDefaultStop.minutes15, TMLStopMinutes.minutes15), (.minutes30, .minutes30), (.minutes60, .minutes60)])
    func timerDefaultsStayTheSameWithOrWithoutACall(defaultStop: TMLDefaultStop, minutes: TMLStopMinutes) {
        #expect(StopChoice(defaultStop: defaultStop, onCall: false) == .minutes(minutes))
        #expect(StopChoice(defaultStop: defaultStop, onCall: true) == .minutes(minutes))
    }

    @Test func beforeSharingTheCallIsOfferedOnlyDuringACall() {
        let timers: [StopChoice] = [.minutes(.minutes15), .minutes(.minutes30), .minutes(.minutes60)]
        #expect(StopChoice.beforeSharing(onCall: false) == timers)
        #expect(StopChoice.beforeSharing(onCall: true) == [.call] + timers)
    }

    @Test func labelsMatchThePrototype() {
        let limit = ShareTime.at(60)
        #expect(StopChoice.call.label(expiresAt: nil) == "When the call ends")
        #expect(StopChoice.minutes(.minutes15).label(expiresAt: nil) == "In 15 min")
        #expect(StopChoice.minutes(.minutes30).label(expiresAt: nil) == "In 30 min")
        #expect(StopChoice.minutes(.minutes60).label(expiresAt: nil) == "In 1 hour")
        #expect(StopChoice.limit.label(expiresAt: limit, locale: ShareTime.locale, timeZone: ShareTime.utc)
            == "At the 1-hour limit \u{00B7} \(ShareTime.clock(limit))")
        #expect(StopChoice.limit.label(expiresAt: nil) == "At the 1-hour limit")
    }

    @Test func idsAreDistinct() {
        let all: [StopChoice] = [.call, .minutes(.minutes15), .minutes(.minutes30), .minutes(.minutes60), .limit]
        #expect(Set(all.map(\.id)).count == all.count)
    }
}

@Suite("Who it's for")
struct ShareAudienceTests {
    @Test func aNameIsTidiedAndUsedInSentences() {
        let mom = ShareAudience("  Mom  ")
        #expect(mom.name == "Mom")
        #expect(mom.they == iso("Mom") && mom.them == iso("Mom"))
        #expect(mom.label == "Mom" && mom.initial == "M")
    }

    @Test(arguments: [nil, "", "   "])
    func withoutANameTheCopySaysTheyAndThem(raw: String?) {
        let none = ShareAudience(raw)
        #expect(none.name == nil)
        #expect(none.they == "They" && none.them == "them" && none.label == "Them")
        #expect(none.initial == nil)
    }

    @Test func aNameStartingWithASymbolShowsThePersonIcon() {
        #expect(ShareAudience("\u{2764}\u{FE0F} Mom").initial == nil)
        #expect(ShareAudience("\u{00E9}lise").initial == "\u{00C9}")
    }
}

@Suite("The share sheet's message")
struct ShareLinkMessageTests {
    let url = URL(string: "https://trackme.live/s/8fK2")!

    @Test func aManualShareSaysItPlainly() {
        let message = ShareLinkMessage(url: url, sharerName: " Alex ", duringCall: false)
        #expect(message.text == "I\u{2019}m sharing my live location with you.")
        #expect(message.previewTitle == "\(iso("Alex")) \u{00B7} Live location")
        #expect(message.url == url)
    }

    @Test func duringACallItSaysWhileWeTalk() {
        #expect(ShareLinkMessage(url: url, sharerName: "Alex", duringCall: true).text
            == "I\u{2019}m sharing my live location with you while we talk.")
    }
}

@Suite("The timer sheet")
struct TimerSheetPresentationTests {
    @Test func marksTheChosenOneAndSaysTheLimit() {
        let sheet = TimerSheetPresentation(choices: StopChoice.beforeSharing(onCall: false), selected: .minutes(.minutes30),
                                           expiresAt: nil, callOffered: false)
        #expect(sheet.title == "When sharing stops")
        #expect(sheet.choices.map(\.label) == ["In 15 min", "In 30 min", "In 1 hour"])
        #expect(sheet.choices.map(\.isSelected) == [false, true, false])
        #expect(sheet.footer == "Sharing never runs longer than 1 hour.")
    }

    @Test func duringACallItExplainsATimerOutlivesTheCall() {
        let sheet = TimerSheetPresentation(choices: StopChoice.beforeSharing(onCall: true), selected: .call,
                                           expiresAt: nil, callOffered: true)
        #expect(sheet.footer == "Sharing never runs longer than 1 hour. If the call drops and you\u{2019}ve set a timer, sharing continues until it runs out.")
        #expect(sheet.choices.first?.isSelected == true)
    }
}

@Suite("Duration and interval text")
struct DurationTextTests {
    @Test(arguments: [(0.0, "< 1 min", "less than a minute"), (59, "< 1 min", "less than a minute"),
                      (60, "1 min", "1 minute"), (119, "1 min", "1 minute"), (240, "4 min", "4 minutes"),
                      (-5, "< 1 min", "less than a minute")])
    func minutes(seconds: Double, short: String, spoken: String) {
        #expect(DurationText.short(seconds) == short)
        #expect(DurationText.spoken(seconds) == spoken)
    }

    @Test func callClock() {
        #expect(DurationText.callClock(0) == "00:00")
        #expect(DurationText.callClock(252) == "04:12")
        #expect(DurationText.callClock(3_725) == "62:05")
        #expect(DurationText.callClock(-3) == "00:00")
    }

    @Test func intervals() {
        let en = Locale(identifier: "en_US")
        #expect(IntervalText.seconds(3.5, locale: en) == ("3.5 s", "3.5 seconds"))
        #expect(IntervalText.seconds(15, locale: en) == ("15 s", "15 seconds"))
        #expect(IntervalText.seconds(5.04, locale: en) == ("5 s", "5 seconds"))
        #expect(IntervalText.seconds(1, locale: en) == ("1 s", "1 second"))
    }
}

@Suite("The ended screen")
struct EndedPresentationTests {
    func ended(_ reason: ShareEndReason, viewerName: String? = "Mom", opened: Date? = ShareTime.at(2),
               endedAt: Date = ShareTime.at(14)) -> EndedPresentation {
        EndedPresentation(ended: EndedShare(sessionId: "s1", reason: reason, startedAt: ShareTime.start, endedAt: endedAt,
                                            viewerName: viewerName, firstViewedAt: opened, confirmed: true),
                          locale: ShareTime.locale, timeZone: ShareTime.utc)
    }

    @Test func stoppedSaysWhen() {
        let p = ended(.stopped)
        #expect(p.title == "Sharing ended")
        #expect(p.message == "You stopped sharing at \(ShareTime.clock(ShareTime.at(14))).")
        #expect(!p.offersShareAgain)
    }

    @Test func theTimerAndTheCallSayWhy() {
        #expect(ended(.timer).message == "Your timer ran out, so sharing stopped.")
        #expect(ended(.timer).title == "Sharing ended")
        #expect(ended(.call).message == "Your call ended, so sharing stopped.")
    }

    @Test func theLimitOffersShareAgain() {
        let p = ended(.limit, endedAt: ShareTime.at(60))
        #expect(p.title == "Sharing stopped after 1 hour")
        #expect(p.message == "That\u{2019}s the longest a link can run. Share again to send a new link.")
        #expect(p.offersShareAgain)
        #expect(p.summary.first { $0.label == "Shared for" }?.value == "60 min")
    }

    @Test func theSummaryNamesThePersonAndWhenTheyOpenedIt() {
        let p = ended(.stopped)
        #expect(p.summary == [
            .init(label: "Shared with", value: "Mom"),
            .init(label: "Shared for", value: "14 min"),
            .init(label: "\(iso("Mom")) opened it", value: ShareTime.clock(ShareTime.at(2))),
        ])
    }

    @Test func withoutANameOrAnOpenTheSummarySaysSo() {
        let p = ended(.timer, viewerName: nil, opened: nil)
        #expect(p.summary == [
            .init(label: "Shared for", value: "14 min"),
            .init(label: "Link opened", value: "Not opened"),
        ])
    }

    @Test func pointsAreDeletedADayAfterTheEnd() {
        #expect(ended(.stopped).deletion
            == "Location points from this session are deleted by \(ShareTime.clock(ShareTime.at(14 + 24 * 60))) tomorrow.")
    }
}
