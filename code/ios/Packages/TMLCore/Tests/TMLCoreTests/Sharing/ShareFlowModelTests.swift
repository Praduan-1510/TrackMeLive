import Foundation
import Testing
@testable import TMLCore

@MainActor
@Suite("Sharing from Home")
struct ShareFlowModelTests {
    let sharing = FixedSharingService()
    let permissions = FixedPermissionsService(notifications: .allowed)

    func flow(_ access: FakeLocationAccess = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, hasAsked: true)),
              user: TMLUser? = .sharer()) -> ShareFlowModel {
        ShareFlowModel(sharing: sharing, access: access, permissions: permissions, profile: { user })
    }

    var starts: Int { sharing.calls.filter { if case .start = $0 { true } else { false } }.count }

    /// Share live location, then the share sheet sends the link.
    func shareAndSend(_ f: ShareFlowModel, copied: Bool = false) async throws {
        await f.startShare()
        let setup = try #require(f.setup)
        await setup.share()
        await setup.shareSheetClosed(.sent(copied: copied))
        f.stateDidChange()
    }

    // MARK: Starting

    @Test func shareScreenStartsFromTheProfile() async throws {
        let f = flow(user: .sharer(lastViewerName: "Mom", defaultStop: .minutes15, precision: .approximate))
        await f.startShare()
        #expect(f.path == [.share])
        let setup = try #require(f.setup)
        #expect(setup.viewerName == "Mom" && setup.stop == .minutes(.minutes15) && setup.precision == .approximate)
        #expect(setup.sharerName == "Alex")
    }

    @Test func neverAskedShowsTheExplainerOnHome() async {
        let f = flow(FakeLocationAccess())
        await f.startShare()
        #expect(f.path.isEmpty && f.setup == nil)
        #expect(f.gate.prompt == .explainer)
        await f.gate.continueFromExplainer()
        #expect(f.path == [.share])
    }

    @Test func deniedStaysOnHomeWithTheAlert() async {
        let f = flow(FakeLocationAccess(authorization: LocationAuthorization(status: .denied, hasAsked: true)))
        await f.startShare()
        #expect(f.path.isEmpty)
        #expect(f.gate.prompt == .turnOn(servicesOff: false))
    }

    @Test func backFromSettingsWithLocationOnOpensTheShareScreen() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .denied, hasAsked: true))
        let f = flow(access)
        await f.startShare()
        _ = f.gate.openSettings()
        access.authorization = LocationAuthorization(status: .whenInUse, hasAsked: true)
        await f.appDidBecomeActive()
        #expect(f.path == [.share])
    }

    @Test func withoutAProfileNothingHappens() async {
        let f = flow(user: nil)
        await f.startShare()
        #expect(f.path.isEmpty && f.gate.prompt == nil)
    }

    @Test func whileSharingShareOpensTheLiveScreen() async {
        sharing.state = .live(.make())
        let f = flow()
        await f.startShare()
        #expect(f.path == [.live])
        #expect(f.setup == nil)
    }

    // MARK: Sent, live, ended

    @Test func sentReplacesTheShareScreenWithTheLiveScreen() async throws {
        let f = flow()
        try await shareAndSend(f)
        #expect(f.path == [.live])
        #expect(f.setup == nil)
        #expect(f.live.toast == nil)
    }

    @Test func copiedSaysSoOnTheLiveScreen() async throws {
        let f = flow()
        try await shareAndSend(f, copied: true)
        #expect(f.live.toast == "Link copied. Paste it wherever you like.")
    }

    @Test func theFirstLinkOffersAlertsWhenTheyveNeverBeenAskedFor() async throws {
        permissions.notifications = .notSet
        let f = flow()
        try await shareAndSend(f)
        #expect(await eventually { f.live.notificationsPrompt != nil })
    }

    @Test func cancelledStaysOnTheShareScreen() async throws {
        let f = flow()
        await f.startShare()
        let setup = try #require(f.setup)
        await setup.share()
        await setup.shareSheetClosed(.cancelled)
        f.stateDidChange()
        #expect(f.path == [.share])
        #expect(sharing.state == .idle)
    }

    @Test func homeFromTheLiveScreenPopsToHome() async throws {
        let f = flow()
        try await shareAndSend(f)
        f.goHome()
        #expect(f.path.isEmpty)
        #expect(sharing.state.isActive)
    }

    @Test func theEndReplacesTheLiveScreen() async throws {
        let f = flow()
        try await shareAndSend(f)
        f.live.isChoosingStop = true
        f.live.sendAgain()
        await f.live.confirmStop()
        f.stateDidChange()
        #expect(f.path == [.ended])
        #expect(!f.live.isChoosingStop && f.live.shareSheet == nil && !f.live.isConfirmingStop)
    }

    @Test func anEndWhileOnHomeShowsTheEndedScreen() async throws {
        let f = flow()
        try await shareAndSend(f)
        f.goHome()
        await sharing.stop()
        f.stateDidChange()
        #expect(f.path == [.ended])
    }

    @Test func anEndDoesntInterruptANewShareBeingSetUp() async throws {
        let f = flow()
        await f.startShare()
        sharing.state = .ended(EndedShare(sessionId: "old", reason: .timer, startedAt: ShareTime.start,
                                          endedAt: ShareTime.at(30), confirmed: true))
        f.stateDidChange()
        #expect(f.path == [.share])
    }

    @Test func doneGoesHome() async throws {
        let f = flow()
        try await shareAndSend(f)
        await f.live.confirmStop()
        f.stateDidChange()
        f.done()
        #expect(f.path.isEmpty)
        #expect(sharing.state == .idle)
        #expect(sharing.calls.last == .dismissEnded)
    }

    @Test func goingIdleLeavesNoSharingScreenBehind() async throws {
        let f = flow()
        try await shareAndSend(f)
        sharing.state = .idle
        f.stateDidChange()
        #expect(f.path.isEmpty)
    }

    @Test func goingIdleKeepsTheShareScreen() async {
        let f = flow()
        await f.startShare()
        f.stateDidChange()
        #expect(f.path == [.share])
    }

    // MARK: Share again

    @Test func shareAgainStartsANewShareWithTheSameChoicesAndOpensTheShareSheet() async throws {
        let f = flow(user: .sharer(lastViewerName: "Dad"))
        await f.startShare()
        let first = try #require(f.setup)
        first.viewerName = "Mom"
        first.choose(stop: .minutes(.minutes15))
        await first.choose(precision: .approximate)
        await first.share()
        await first.shareSheetClosed(.sent(copied: false))
        let live = try #require(sharing.state.live)
        sharing.state = .ended(EndedShare(sessionId: live.sessionId, reason: .limit, startedAt: live.startedAt,
                                          endedAt: live.expiresAt, viewerName: "Mom", confirmed: true))
        f.stateDidChange()
        #expect(f.path == [.ended])

        await f.shareAgain()
        #expect(f.path == [.share])
        let again = try #require(f.setup)
        #expect(await eventually { again.shareSheet != nil })
        #expect(again.viewerName == "Mom" && again.stop == .minutes(.minutes15) && again.precision == .approximate)
        #expect(starts == 2)
        #expect(sharing.calls.contains(.dismissEnded))
    }

    // MARK: Deep links

    @Test func theLiveActivityOpensTheLiveScreen() async {
        sharing.state = .live(.make())
        let f = flow()
        await f.open(.live)
        #expect(f.path == [.live])
        #expect(!f.live.isConfirmingStop)
    }

    @Test func itsStopSharingOpensTheConfirmation() async {
        sharing.state = .live(.make())
        let f = flow()
        await f.open(.stop)
        #expect(f.path == [.live])
        #expect(f.live.isConfirmingStop)
    }

    @Test func afterTheEndTheLiveLinkShowsTheEndedScreen() async {
        sharing.state = .ended(EndedShare(sessionId: "s1", reason: .timer, startedAt: ShareTime.start,
                                          endedAt: ShareTime.at(30), confirmed: true))
        let f = flow()
        await f.open(.stop)
        #expect(f.path == [.ended])
    }

    @Test func withNothingRunningTheLiveLinkStaysHome() async {
        let f = flow()
        await f.open(.live)
        #expect(f.path.isEmpty)
    }

    @Test func aNewShareAfterAnUndismissedEndStartsClean() async {
        sharing.state = .ended(EndedShare(sessionId: "s1", reason: .timer, startedAt: ShareTime.start,
                                          endedAt: ShareTime.at(30), confirmed: true))
        let f = flow()
        await f.open(.share)
        #expect(sharing.state == .idle)
        #expect(sharing.calls == [.dismissEnded])
        #expect(f.path == [.share])
    }

    @Test func theControlOpensTheShareScreen() async {
        let f = flow()
        await f.open(.share)
        #expect(f.path == [.share])
    }
}

@Suite("Home's live card")
struct HomeShareCardTests {
    @Test func onlyWhileSharing() {
        #expect(HomeShareCard(state: .idle) == nil)
        #expect(HomeShareCard(state: .starting) == nil)
        #expect(HomeShareCard(state: .ended(EndedShare(sessionId: "s1", reason: .stopped, startedAt: ShareTime.start,
                                                         endedAt: ShareTime.at(5), confirmed: true))) == nil)
    }

    @Test func namesWhoItsFor() {
        let card = HomeShareCard(state: .live(.make(viewerName: "Mom")))
        #expect(card?.title == "Sharing with \(iso("Mom"))")
        #expect(card?.message == "Tap to open the map.")
    }

    @Test func withoutANameItSaysSharingLive() {
        #expect(HomeShareCard(state: .live(.make(viewerName: nil)))?.title == "Sharing live")
    }

    @Test func liveTogetherSaysYoureBothLive() {
        let share = LiveShare.make(viewerSharing: true)
        #expect(HomeShareCard(state: .live(share))?.message == "Tap to open the map.")
        #expect(HomeShareCard(state: .live(share), liveTogether: true)?.message == "You\u{2019}re both live. Tap to open the map.")
    }
}
