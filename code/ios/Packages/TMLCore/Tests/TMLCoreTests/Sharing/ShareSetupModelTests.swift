import Foundation
import Testing
@testable import TMLCore

/// What the share screen handed on when the link went out.
@MainActor
final class SharedRecorder {
    private(set) var copied: [Bool] = []
    func record(_ copied: Bool) { self.copied.append(copied) }
}

@MainActor
@Suite("The share screen")
struct ShareSetupModelTests {
    let sharing = FixedSharingService()
    let shared = SharedRecorder()
    let allowed = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, hasAsked: true))
    let approximateOnly = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, precise: false, hasAsked: true))

    func model(_ user: TMLUser = .sharer(), precision: TMLPrecision = .precise, access: FakeLocationAccess? = nil) -> ShareSetupModel {
        ShareSetupModel(settings: user.settings, lastViewerName: user.lastViewerName, sharerName: user.name,
                        gatePrecision: precision, sharing: sharing, access: access ?? allowed, onShared: shared.record)
    }

    var startedOptions: [ShareOptions] {
        sharing.calls.compactMap { if case .start(let options) = $0 { options } else { nil } }
    }

    // MARK: What it starts with

    @Test func startsWithTheLastNameAndSettingsDefaults() {
        let m = model(.sharer(lastViewerName: "Mom", defaultStop: .minutes15))
        #expect(m.viewerName == "Mom")
        #expect(m.stop == .minutes(.minutes15))
        #expect(m.stopLabel == "In 15 min")
        #expect(m.precision == .precise)
        #expect(m.canClearName)
    }

    @Test func aCallDefaultWithoutACallIsThirtyMinutes() {
        let m = model(.sharer(defaultStop: .call))
        #expect(m.stop == .minutes(.minutes30))
        #expect(m.stopLabel == "In 30 min")
    }

    @Test func aManualShareSaysWhoeverGetsTheLink() {
        let m = model()
        #expect(m.lede == "Whoever gets the link follows you live in their browser. No app needed.")
        #expect(m.previewCaption == "They see you move as you go")
        #expect(!m.showsShareBack && !m.showsTogether)
    }

    @Test func noLastNameStartsEmpty() {
        let m = model(.sharer(lastViewerName: nil))
        #expect(m.viewerName.isEmpty && !m.canClearName)
        #expect(m.previewViewerName == "Them")
    }

    @Test func theGatesPrecisionWins() {
        #expect(model(.sharer(precision: .precise), precision: .approximate).precision == .approximate)
    }

    // MARK: Who it's for

    @Test func typingStopsAt24Characters() {
        let m = model()
        m.viewerName = String(repeating: "a", count: 30)
        #expect(m.viewerName.count == 24)
        m.viewerName = "Mom\nand Dad"
        #expect(m.viewerName == "Mom and Dad")
    }

    @Test func clearEmptiesTheName() {
        let m = model()
        m.clearViewerName()
        #expect(m.viewerName.isEmpty && !m.canClearName)
    }

    // MARK: Stops and Location

    @Test func theTimerSheetOffersTheTimersWithTheChosenOneMarked() {
        let m = model()
        m.isChoosingStop = true
        let sheet = m.timerSheet
        #expect(sheet.choices.map(\.choice) == [.minutes(.minutes15), .minutes(.minutes30), .minutes(.minutes60)])
        #expect(sheet.choices.first { $0.isSelected }?.choice == .minutes(.minutes30))
        m.choose(stop: .minutes(.minutes60))
        #expect(m.stop == .minutes(.minutes60) && !m.isChoosingStop)
        #expect(m.stopLabel == "In 1 hour")
    }

    @Test func choicesNotOnOfferAreIgnored() {
        let m = model()
        m.choose(stop: .call)
        #expect(m.stop == .minutes(.minutes30))
        m.choose(stop: .limit)
        #expect(m.stop == .minutes(.minutes30))
    }

    @Test func approximateAndBackAgain() async {
        let m = model()
        await m.choose(precision: .approximate)
        #expect(m.precision == .approximate)
        await m.choose(precision: .precise)
        #expect(m.precision == .precise)
        #expect(allowed.requests.isEmpty)
    }

    @Test func withPreciseOffTheMenuSaysSo() {
        let m = model(precision: .approximate, access: approximateOnly)
        #expect(m.isPreciseOff)
        #expect(m.precisionDetail(.precise) == "Precise is off in Settings")
        #expect(m.precisionDetail(.approximate) == "Within about 500 m")
        #expect(model().precisionDetail(.precise) == "Your exact spot")
    }

    @Test func preciseWhileOffAsksForTheOneTimeRequest() async {
        let m = model(precision: .approximate, access: approximateOnly)
        await m.choose(precision: .precise)
        #expect(approximateOnly.requests == ["preciseOnce"])
        #expect(m.precision == .precise && m.prompt == nil)
    }

    @Test func aRefusedOneTimeRequestStaysApproximateAndExplainsSettings() async {
        approximateOnly.grantsPreciseOnce = false
        let m = model(precision: .approximate, access: approximateOnly)
        await m.choose(precision: .precise)
        #expect(m.precision == .approximate)
        #expect(m.prompt == .preciseOff)
        #expect(m.openSettings() == approximateOnly.settingsURL)
        #expect(m.prompt == nil)
    }

    // MARK: Share

    @Test func shareStartsTheSessionAndOpensTheShareSheet() async {
        let m = model(.sharer(lastViewerName: "  Mom "))
        await m.share()
        #expect(startedOptions == [ShareOptions(viewerName: "  Mom ", stop: .minutes(.minutes30), callId: nil,
                                                shareBack: false, precision: .precise)])
        #expect(startedOptions.first?.request.viewerName == "Mom")
        let sheet = m.shareSheet
        #expect(sheet != nil)
        #expect(sheet?.url == sharing.state.live?.link.url)
        #expect(sheet?.text == "I\u{2019}m sharing my live location with you.")
        #expect(sheet?.previewTitle == "\(iso("Alex")) \u{00B7} Live location")
        #expect(m.isStarting)
        #expect(shared.copied.isEmpty)
    }

    @Test func anEmptyNameIsSentAsNone() async {
        let m = model()
        m.viewerName = "   "
        await m.share()
        #expect(startedOptions.first?.viewerName == nil)
    }

    @Test func preciseOffAlwaysSharesApproximate() async {
        let m = model(precision: .precise, access: approximateOnly)
        await m.share()
        #expect(startedOptions.first?.precision == .approximate)
    }

    @Test func sentGoesOnToTheLiveScreen() async {
        let m = model()
        await m.share()
        await m.shareSheetClosed(.sent(copied: false))
        #expect(shared.copied == [false])
        #expect(m.shareSheet == nil && !m.isStarting)
        #expect(!sharing.calls.contains(.discard))
    }

    @Test func copyLinkCountsAsSent() async {
        let m = model()
        await m.share()
        await m.shareSheetClosed(.sent(copied: true))
        #expect(shared.copied == [true])
    }

    @Test func closingWithoutAChoiceDiscardsTheSession() async {
        let m = model()
        await m.share()
        await m.shareSheetClosed(.cancelled)
        #expect(sharing.calls.last == .discard)
        #expect(sharing.state == .idle)
        #expect(shared.copied.isEmpty && m.error == nil && !m.isStarting && m.shareSheet == nil)
    }

    @Test func aLinkOpenedBeforeTheDiscardCarriesOn() async {
        let m = model()
        await m.share()
        sharing.nextError = .linkOpened
        await m.shareSheetClosed(.cancelled)
        #expect(shared.copied == [false])
        #expect(m.error == nil)
    }

    @Test func aStartThatFailsSaysWhyAndCanBeTriedAgain() async {
        let m = model()
        sharing.nextError = .offline
        await m.share()
        #expect(m.error == .offline)
        #expect(m.error?.message == "We couldn\u{2019}t reach Track Me Live. Check your connection, then try again.")
        #expect(!m.isStarting && m.shareSheet == nil)
        await m.share()
        #expect(m.error == nil && m.shareSheet != nil)
        #expect(startedOptions.count == 2)
    }

    @Test func alreadySharingOpensTheRunningShare() async {
        sharing.state = .live(.make())
        let m = model()
        sharing.nextError = .alreadySharing(sessionId: "s1")
        await m.share()
        #expect(shared.copied == [false])
        #expect(m.error == nil)
    }

    @Test func alreadySharingElsewhereSaysSo() async {
        let m = model()
        sharing.nextError = .alreadySharing(sessionId: "other")
        await m.share()
        #expect(m.error == .alreadySharing(sessionId: "other"))
        #expect(shared.copied.isEmpty)
    }

    @Test func aSecondTapWhileStartingDoesNothing() async {
        let m = model()
        await m.share()
        await m.share()
        #expect(startedOptions.count == 1)
    }
}
