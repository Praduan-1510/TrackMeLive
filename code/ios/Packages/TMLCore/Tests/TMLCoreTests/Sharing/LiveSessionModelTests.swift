import Foundation
import Testing
@testable import TMLCore

@MainActor
@Suite("The live screen")
struct LiveSessionModelTests {
    let sharing = FixedSharingService(state: .live(.make()))
    let access = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, hasAsked: true))
    let permissions = FixedPermissionsService()

    func model(access: FakeLocationAccess? = nil) -> LiveSessionModel {
        LiveSessionModel(sharing: sharing, access: access ?? self.access, permissions: permissions, sharerName: { "Alex" })
    }

    // MARK: Words

    @Test func showsTheShareUntilItEnds() async {
        let m = model()
        #expect(m.presentation(at: ShareTime.at(1))?.title == "Sharing live")
        await m.confirmStop()
        #expect(m.presentation(at: ShareTime.at(1)) == nil)
        #expect(m.timerSheet(at: ShareTime.at(1)) == nil)
    }

    @Test func preciseOffInSettingsShowsInTheLocationControl() {
        let off = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, precise: false, hasAsked: true))
        #expect(model(access: off).presentation(at: ShareTime.at(1))?.precision.canChoosePrecise == false)
    }

    // MARK: Timer sheet

    @Test func theTimerSheetDropsTimersThatWouldPassTheLimit() throws {
        let sheet = try #require(model().timerSheet(at: ShareTime.at(10)))
        #expect(sheet.choices.map(\.choice) == [.minutes(.minutes15), .minutes(.minutes30), .limit])
        #expect(try #require(model().timerSheet(at: ShareTime.at(46))).choices.map(\.choice) == [.limit])
        #expect(sheet.choices.first { $0.isSelected }?.choice == .minutes(.minutes30))
        #expect(sheet.choices.last?.label.hasPrefix("At the 1-hour limit \u{00B7} ") == true)
        #expect(sheet.footer == "Sharing never runs longer than 1 hour.")
    }

    @Test func aOneHourTimerReadsAsTheLimit() throws {
        sharing.state = .live(.make(stop: .minutes(.minutes60)))
        let sheet = try #require(model().timerSheet(at: ShareTime.at(1)))
        #expect(sheet.choices.first { $0.isSelected }?.choice == .limit)
    }

    @Test func choosingATimerChangesTheStop() async {
        let m = model()
        m.isChoosingStop = true
        await m.choose(stop: .minutes(.minutes15))
        #expect(!m.isChoosingStop)
        #expect(sharing.calls == [.changeStop(.minutes(.minutes15))])
        #expect(sharing.state.live?.stopMinutes == .minutes15)
        #expect(m.error == nil)
    }

    @Test func aTimerChangeThatFailsSaysWhy() async {
        let m = model()
        sharing.nextError = .offline
        await m.choose(stop: .limit)
        #expect(m.error == .offline)
        await m.choose(stop: .limit)
        #expect(m.error == nil)
    }

    // MARK: Location

    @Test func theSamePrecisionChangesNothing() async {
        let m = model()
        await m.choose(precision: .precise)
        #expect(sharing.calls.isEmpty)
    }

    @Test func approximateAppliesFromTheNextUpdate() async {
        let m = model()
        await m.choose(precision: .approximate)
        #expect(sharing.calls == [.changePrecision(.approximate)])
        #expect(m.presentation(at: ShareTime.at(1))?.precision.note == "From the next update")
        #expect(access.requests.isEmpty)
    }

    @Test func preciseWhileOffAsksForTheOneTimeRequestFirst() async {
        sharing.state = .live(.make(precision: .approximate))
        let off = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, precise: false, hasAsked: true))
        let m = model(access: off)
        await m.choose(precision: .precise)
        #expect(off.requests == ["preciseOnce"])
        #expect(sharing.calls == [.changePrecision(.precise)])
    }

    @Test func aRefusedOneTimeRequestChangesNothingAndExplainsSettings() async {
        sharing.state = .live(.make(precision: .approximate))
        let off = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, precise: false, hasAsked: true),
                                     grantsPreciseOnce: false)
        let m = model(access: off)
        await m.choose(precision: .precise)
        #expect(sharing.calls.isEmpty)
        #expect(m.prompt == .preciseOff)
        #expect(m.openSettings() == off.settingsURL && m.prompt == nil)
    }

    @Test func aPrecisionChangeThatFailsSaysWhy() async {
        let m = model()
        sharing.nextError = .sessionEnded
        await m.choose(precision: .approximate)
        #expect(m.error == .sessionEnded)
    }

    // MARK: Send link again

    @Test func sendAgainReopensTheShareSheetWithTheSameLink() {
        let m = model()
        m.sendAgain()
        #expect(m.shareSheet?.url == sharing.state.live?.link.url)
        #expect(m.shareSheet?.text == "I\u{2019}m sharing my live location with you.")
        m.shareSheetClosed(.sent(copied: false))
        #expect(m.shareSheet == nil && m.toast == nil)
        #expect(sharing.calls.isEmpty)
    }

    @Test func copyingSaysSoForAMoment() async {
        let m = model()
        m.sendAgain()
        m.shareSheetClosed(.sent(copied: true))
        #expect(m.toast == "Link copied. Paste it wherever you like.")
        m.dismissToast()
        #expect(m.toast == nil)
        m.show(toast: "Gone soon", for: .milliseconds(5))
        #expect(m.toast == "Gone soon")
        #expect(await eventually { m.toast == nil })
    }

    @Test func aNewerToastOutlastsTheOlderOnesTimer() async throws {
        let m = model()
        m.show(toast: "First", for: .milliseconds(5))
        m.show(toast: "Second", for: .seconds(30))
        try await Task.sleep(for: .milliseconds(30))
        #expect(m.toast == "Second")
    }

    @Test func cancellingTheShareSheetChangesNothing() {
        let m = model()
        m.sendAgain()
        m.shareSheetClosed(.cancelled)
        #expect(m.shareSheet == nil && sharing.calls.isEmpty && sharing.state.isActive)
    }

    @Test func sendAgainAfterTheEndDoesNothing() {
        sharing.state = .idle
        let m = model()
        m.sendAgain()
        #expect(m.shareSheet == nil)
    }

    // MARK: Stop

    @Test func stopAsksFirst() {
        let m = model()
        m.requestStop()
        #expect(m.isConfirmingStop)
        #expect(sharing.calls.isEmpty)
    }

    @Test func confirmingStopsTheShare() async {
        let m = model()
        m.requestStop()
        await m.confirmStop()
        #expect(!m.isConfirmingStop && !m.isStopping)
        #expect(sharing.calls == [.stop])
        #expect(sharing.state.ended?.reason == .stopped)
    }

    @Test func stopWithNothingRunningAsksNothing() async {
        sharing.state = .idle
        let m = model()
        m.requestStop()
        #expect(!m.isConfirmingStop)
        await m.confirmStop()
        #expect(sharing.calls.isEmpty)
    }

    // MARK: Alerts after the first link

    @Test func afterTheFirstLinkItOffersAlerts() async {
        let m = model()
        await m.linkWasSent()
        #expect(m.notificationsPrompt == NotificationsPrompt(viewerName: "Mom"))
        #expect(m.notificationsPrompt?.title == "Know when \(iso("Mom")) opens it")
        #expect(m.notificationsPrompt?.confirmTitle == "Turn on alerts")
        await m.turnOnAlerts()
        #expect(m.notificationsPrompt == nil)
        #expect(permissions.requests == ["notifications"] && permissions.notifications == .allowed)
    }

    @Test func withoutANameTheAlertsOfferIsGeneral() {
        #expect(NotificationsPrompt(viewerName: nil).title == "Know when your link is opened")
        #expect(NotificationsPrompt(viewerName: nil).message == PermissionPrompt.notificationsExplainer.message)
    }

    @Test(arguments: [NotificationPermission.allowed, .off])
    func alertsAlreadyDecidedAreNotOfferedAgain(state: NotificationPermission) async {
        permissions.notifications = state
        let m = model()
        await m.linkWasSent()
        #expect(m.notificationsPrompt == nil)
    }
}
