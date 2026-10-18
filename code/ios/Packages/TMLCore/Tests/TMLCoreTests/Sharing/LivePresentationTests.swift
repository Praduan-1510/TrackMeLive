import Foundation
import Testing
@testable import TMLCore

@Suite("The live screen's words")
struct LivePresentationTests {
    // MARK: Title, badge and the line under it

    @Test func beforeTheLinkIsOpenedItSaysTheLinkWasSent() {
        let p = LivePresentation.at(1, .make())
        #expect(p.title == "Sharing live")
        #expect(p.badge == .init(title: "Live", spoken: "Sharing live", tone: .live))
        #expect(p.subtitle == "Link sent to \(iso("Mom")). You\u{2019}ll know when it\u{2019}s opened.")
    }

    @Test func withoutANameTheLinkWasSentToNobodyInParticular() {
        #expect(LivePresentation.at(1, .make(viewerName: nil)).subtitle == "Link sent. You\u{2019}ll know when it\u{2019}s opened.")
    }

    @Test func onceOpenedItSaysWhen() {
        let opened = ShareTime.at(2)
        #expect(LivePresentation.at(3, .make(firstViewedAt: opened)).subtitle
            == "\(iso("Mom")) opened your link at \(ShareTime.clock(opened)).")
        #expect(LivePresentation.at(3, .make(viewerName: nil, firstViewedAt: opened)).subtitle
            == "They opened your link at \(ShareTime.clock(opened)).")
    }

    @Test func waitingForTheFirstFixStillReadsAsLive() {
        let p = LivePresentation.at(0.2, .make(upload: .waitingForFix))
        #expect(p.badge.tone == .live)
        #expect(p.you.status == "Live")
    }

    @Test func noGPSSignalSaysWhatTheyllSee() {
        let p = LivePresentation.at(5, .make(upload: .noSignal(lastFixAt: ShareTime.at(4))))
        #expect(p.badge == .init(title: "No signal", spoken: "No GPS signal", tone: .quiet))
        #expect(p.subtitle == "No GPS signal right now. \(iso("Mom")) will see where you were last seen when they open the link.")
        let opened = LivePresentation.at(5, .make(firstViewedAt: ShareTime.at(1), upload: .noSignal(lastFixAt: nil)))
        #expect(opened.subtitle == "No GPS signal right now. \(iso("Mom")) sees where you were last seen.")
    }

    @Test func offlineSaysWhatTheySee() {
        let p = LivePresentation.at(5, .make(viewerName: nil, firstViewedAt: ShareTime.at(1), upload: .offline))
        #expect(p.badge == .init(title: "No connection", spoken: "No connection", tone: .quiet))
        #expect(p.subtitle == "No connection right now. They see where you were last seen.")
        let unopened = LivePresentation.at(5, .make(viewerName: nil, upload: .offline))
        #expect(unopened.subtitle == "No connection right now. They\u{2019}ll see where you were last seen when they open the link.")
    }

    // MARK: The 1-hour warning

    @Test func theLimitWarningShowsFiveMinutesBeforeTheLimit() {
        let share = LiveShare.make(stop: .limit)
        #expect(LivePresentation.at(54.9, share).limitWarning == nil)
        #expect(LivePresentation.at(55, share).limitWarning
            == "Sharing stops at \(ShareTime.clock(ShareTime.at(60))) \u{00B7} 1-hour limit")
        #expect(LivePresentation.at(59.5, share).limitWarning != nil)
    }

    @Test func aTimerEndingSoonerNeverShowsTheLimitWarning() {
        #expect(LivePresentation.at(56, .make(stop: .minutes(.minutes30))).limitWarning == nil)
    }

    @Test func aOneHourTimerEndsAtTheLimitSoItWarns() {
        #expect(LivePresentation.at(57, .make(stop: .minutes(.minutes60))).limitWarning != nil)
    }

    // MARK: Tiles

    @Test func tilesForAManualShare() {
        let p = LivePresentation.at(4.5, .make(stop: .minutes(.minutes30)))
        #expect(p.distance == .init(value: "\u{2014}", label: "not shared", spoken: "Distance not shared", ticking: false))
        #expect(p.duration == .init(value: "4 min", label: "sharing", spoken: "Sharing for 4 minutes", ticking: true))
        let stops = ShareTime.clock(ShareTime.at(30))
        #expect(p.stops.value == stops.replacingOccurrences(of: " ", with: "\u{00A0}"))
        #expect(p.stops.label == "stops" && p.stops.spoken == "Stops at \(stops)")
    }

    @Test func theFirstMinuteReadsAsUnderAMinute() {
        #expect(LivePresentation.at(0.5, .make()).duration.value == "< 1 min")
        #expect(LivePresentation.at(0.5, .make()).duration.spoken == "Sharing for less than a minute")
    }

    @Test func theCallRuleSaysWhenTheCallEnds() {
        let p = LivePresentation.at(1, .make(stop: .call, callId: "c1", callActive: true))
        #expect(p.stops == .init(value: "When call ends", label: "stops", spoken: "Stops when the call ends", ticking: false))
    }

    // MARK: Rows

    @Test func yourRowShowsPrecisionAndTheRealInterval() {
        let precise = LivePresentation.at(1, .make(pingInterval: 3.5)).you
        #expect(precise == .init(name: "You", detail: "Precise \u{00B7} every 3.5 s", spokenDetail: "Precise, updates every 3.5 seconds",
                                 status: "Live", tone: .sharer, isQuiet: false))
        let approximate = LivePresentation.at(1, .make(precision: .approximate, pingInterval: 15)).you
        #expect(approximate.detail == "Approximate \u{00B7} every 15 s")
    }

    @Test func yourRowWithoutPointsIsLastSeen() {
        let noGPS = LivePresentation.at(1, .make(upload: .noSignal(lastFixAt: nil))).you
        #expect(noGPS.detail == "No GPS signal" && noGPS.status == "Last seen" && noGPS.tone == .quiet && noGPS.isQuiet)
        let offline = LivePresentation.at(1, .make(upload: .offline)).you
        #expect(offline.detail == "No connection" && offline.status == "Last seen")
    }

    @Test func theViewerWaitsThenWatches() {
        let waiting = LivePresentation.at(1, .make()).viewer
        #expect(waiting == .init(name: "Mom", detail: "Link sent \u{00B7} not opened yet", spokenDetail: "Link sent, not opened yet",
                                 status: "Waiting", tone: .quiet, isQuiet: true))
        let opened = ShareTime.at(2)
        let watching = LivePresentation.at(3, .make(firstViewedAt: opened)).viewer
        #expect(watching.detail == "Opened at \(ShareTime.clock(opened))")
        #expect(watching.status == "Watching" && !watching.isQuiet)
    }

    @Test func theViewersRowSaysThemAndShowsAPersonIconWithoutAName() {
        let p = LivePresentation.at(1, .make(viewerName: nil))
        #expect(p.viewer.name == "Them")
        #expect(p.viewerInitial == nil)
        #expect(LivePresentation.at(1, .make()).viewerInitial == "M")
    }

    // MARK: Location control

    @Test(arguments: [(TMLPrecision.precise, "Your exact spot"), (.approximate, "Within about 500 m")])
    func theLocationControlExplainsEachChoice(precision: TMLPrecision, note: String) {
        let control = LivePresentation.at(1, .make(precision: precision)).precision
        #expect(control == .init(shown: precision, note: note, canChoosePrecise: true))
    }

    @Test func aPendingChangeShowsAndSaysItAppliesNext() {
        let control = LivePresentation.at(1, .make(precision: .precise, precisionNext: .approximate)).precision
        #expect(control.shown == .approximate)
        #expect(control.note == "From the next update")
    }

    @Test func aPendingChangeBackToTheCurrentOneIsNoChange() {
        let control = LivePresentation.at(1, .make(precision: .precise, precisionNext: .precise)).precision
        #expect(control.shown == .precise && control.note == "Your exact spot")
    }

    @Test func withPreciseOffInSettingsPreciseCantBeChosen() {
        let control = LivePresentation.at(1, .make(precision: .approximate), preciseAllowed: false).precision
        #expect(control == .init(shown: .approximate, note: "Precise is off in Settings", canChoosePrecise: false))
    }

    // MARK: Bar and Stop

    @Test func theBarSaysWhenSharingStops() {
        let p = LivePresentation.at(1, .make(stop: .minutes(.minutes15)))
        #expect(p.bar == .init(title: "Sharing live", subtitle: "Stops at \(ShareTime.clock(ShareTime.at(15)))", isCall: false))
    }

    @Test func stopsMessageDependsOnWhetherTheLinkWasOpened() {
        #expect(LivePresentation.at(1, .make()).stopMessage == "Your link will stop working.")
        #expect(LivePresentation.at(3, .make(firstViewedAt: ShareTime.at(2))).stopMessage == "\(iso("Mom")) will see that sharing ended.")
        #expect(LivePresentation.at(3, .make(viewerName: nil, firstViewedAt: ShareTime.at(2))).stopMessage
            == "They\u{2019}ll see that sharing ended.")
    }

    // MARK: Sprint 3 seam: Live Together stays off

    @Test func withoutLiveTogetherNoShareBackShows() {
        let share = LiveShare.make(firstViewedAt: ShareTime.at(1), callId: "c1", callActive: true, shareBackAllowed: true,
                                   viewerSharing: true, shareBackRequestedAt: ShareTime.at(2))
        let p = LivePresentation.at(3, share)
        #expect(p.title == "Sharing live")
        #expect(p.shareBackNote == nil)
        #expect(p.distance.value == "\u{2014}")
        #expect(p.viewer.status == "Watching" && p.viewer.detail.hasPrefix("Opened at"))
        #expect(!p.bar.isCall)
    }

    @Test func liveTogetherWaitsForThemToShareThenShowsTheDistance() {
        let waiting = LivePresentation.at(3, .make(firstViewedAt: ShareTime.at(1), callId: "c1", callActive: true,
                                                   shareBackAllowed: true), liveTogether: true, callStartedAt: ShareTime.at(-1))
        #expect(waiting.distance.value == "Waiting" && waiting.distance.label == "for \(iso("Mom")) to share")
        #expect(waiting.subtitle.hasSuffix(" Share back is on."))
        #expect(waiting.bar == .init(title: "On a call", subtitle: "04:00", isCall: true))

        let distance = DistanceText(meters: 1_234, units: .metric, locale: ShareTime.locale)
        let together = LivePresentation.at(3, .make(firstViewedAt: ShareTime.at(1), callId: "c1", callActive: true,
                                                    shareBackAllowed: true, viewerSharing: true),
                                           liveTogether: true, viewerDistance: distance)
        #expect(together.title == "Live Together")
        #expect(together.distance.value == "1.2 km" && together.distance.label == "apart")
        #expect(together.viewer.status == "Live" && together.viewer.tone == .viewer)
        #expect(together.subtitle.hasSuffix("and is sharing back."))
    }

    @Test func liveTogetherExplainsWhyShareBackIsntOnOffer() {
        let manual = LivePresentation.at(1, .make(viewerName: nil), liveTogether: true)
        #expect(manual.shareBackNote == "They can share back only when you start sharing during a call.")
        let ended = LivePresentation.at(1, .make(callId: "c1", callActive: false, shareBackAllowed: true), liveTogether: true)
        #expect(ended.shareBackNote == "Share back ended with the call.")
        let off = LivePresentation.at(1, .make(callId: "c1", callActive: true, shareBackAllowed: false), liveTogether: true)
        #expect(off.shareBackNote == "Share back is off for this call.")
    }
}
