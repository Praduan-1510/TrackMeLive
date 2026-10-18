import Foundation
import Testing
@testable import TMLCore

/// A profile service whose settings saves wait until the test lets each one answer.
@MainActor
final class GatedProfileService: ProfileService {
    private(set) var savedSettings: [TMLUserSettings] = []
    /// Answers to give, in order; nil succeeds.
    var answers: [ProfileError?] = []
    private var gates: [CheckedContinuation<Void, Never>] = []

    var waiting: Int { gates.count }

    func save(name: String) async throws(ProfileError) {}
    func save(mascot: TMLMascotId, color: TMLMascotColor, accessory: TMLMascotAccessory?) async throws(ProfileError) {}
    func deleteAccount() async throws(ProfileError) {}

    func save(settings: TMLUserSettings) async throws(ProfileError) {
        savedSettings.append(settings)
        await withCheckedContinuation { gates.append($0) }
        if !answers.isEmpty, let error = answers.removeFirst() { throw error }
    }

    /// Lets the oldest waiting save answer.
    func answerNext() async {
        while gates.isEmpty { await Task.yield() }
        gates.removeFirst().resume()
    }
}

@MainActor
@Suite("Settings screen")
struct SettingsModelTests {
    let store = InMemorySettingsStore()
    let permissions = FixedPermissionsService()

    func model(_ profile: any ProfileService, onDeleted: @escaping @MainActor () -> Void = {}) -> SettingsModel {
        SettingsModel(settings: .defaults, profile: profile, deviceSettings: store, permissions: permissions,
                      onAccountDeleted: onDeleted)
    }

    @Test func aSwitchSavesTheWholeSettings() async {
        let service = FakeProfileService()
        let m = model(service)
        m.set(\.offerOnCall, to: false)
        await m.waitForSaves()
        var expected = TMLUserSettings.defaults
        expected.offerOnCall = false
        #expect(service.calls == [.settings(expected)])
        #expect(m.settings == expected && m.saveError == nil)
    }

    @Test func settingTheSameValueSavesNothing() async {
        let service = FakeProfileService()
        let m = model(service)
        m.set(\.precision, to: .precise)
        await m.waitForSaves()
        #expect(service.calls.isEmpty)
    }

    /// A burst of changes while a save is out sends one more save with all of them, not one each.
    @Test func changesDuringASaveGoOutTogetherNext() async {
        let service = GatedProfileService()
        let m = model(service)
        m.set(\.offerOnCall, to: false)
        while service.waiting == 0 { await Task.yield() }
        m.set(\.shareBack, to: false)
        m.set(\.defaultStop, to: .minutes30)
        await service.answerNext()
        await service.answerNext()
        await m.waitForSaves()
        #expect(service.savedSettings.count == 2)
        let last = service.savedSettings.last
        #expect(last?.offerOnCall == false && last?.shareBack == false && last?.defaultStop == .minutes30)
    }

    @Test func aFailedSaveGoesBackToTheProfileAndSaysWhy() async {
        let service = FakeProfileService()
        service.nextError = .offline
        let m = model(service)
        m.set(\.alertExpiry, to: false)
        #expect(m.settings.alertExpiry == false) // on screen at once
        await m.waitForSaves()
        #expect(m.settings == .defaults)
        #expect(m.saveError == .offline)
        m.set(\.alertExpiry, to: false)
        await m.waitForSaves()
        #expect(m.saveError == nil && m.settings.alertExpiry == false)
    }

    /// When the first save fails but a newer change is waiting, that change carries both.
    @Test func aNewerChangeRetriesAFailedOne() async {
        let service = GatedProfileService()
        service.answers = [.offline, nil]
        let m = model(service)
        m.set(\.alertLinkOpened, to: false)
        while service.waiting == 0 { await Task.yield() }
        m.set(\.alertCallEnded, to: false)
        await service.answerNext()
        await service.answerNext()
        await m.waitForSaves()
        #expect(m.settings.alertLinkOpened == false && m.settings.alertCallEnded == false)
        #expect(m.saveError == nil)
    }

    @Test func followsTheProfileWhenIdle() {
        let m = model(FakeProfileService())
        var remote = TMLUserSettings.defaults
        remote.precision = .approximate
        m.profileDidChange(TMLUser(name: "Alex", mascotId: .fox, mascotColor: .original, settings: remote,
                                   createdAt: .distantPast, updatedAt: .distantPast))
        #expect(m.settings.precision == .approximate)
    }

    @Test func appearanceStaysOnThisDevice() {
        let service = FakeProfileService()
        let m = model(service)
        #expect(m.appearance == .system)
        m.appearance = .dark
        #expect(store.appearance == .dark)
        #expect(service.calls.isEmpty)
        #expect(AppearancePreference.allCases.map(\.title) == ["System", "Light", "Dark"])
    }

    @Test func locationGoesThroughTheExplainerFirst() async {
        let m = model(FakeProfileService())
        await m.tapLocation()
        #expect(m.prompt == .locationExplainer)
        #expect(permissions.requests.isEmpty) // nothing asked until Continue
        let destination = await m.confirm(.locationExplainer)
        #expect(destination == nil && m.prompt == nil)
        #expect(permissions.location == .whileUsing(precise: true))
        await m.tapLocation()
        #expect(m.prompt == nil && permissions.requests == ["location"]) // allowed: nothing to do
    }

    @Test func askNextTimeGoesStraightToTheSystemPrompt() async {
        permissions.location = .askNextTime
        let m = model(FakeProfileService())
        await m.tapLocation()
        #expect(m.prompt == nil && permissions.requests == ["location"])
    }

    @Test func offPermissionsOfferSettings() async {
        permissions.location = .off
        permissions.notifications = .off
        let m = model(FakeProfileService())
        await m.tapLocation()
        #expect(m.prompt == .locationOff)
        #expect(await m.confirm(.locationOff) == .app)
        await m.tapNotifications()
        #expect(m.prompt == .notificationsOff)
        #expect(await m.confirm(.notificationsOff) == .notifications)
        #expect(permissions.requests.isEmpty)
    }

    @Test func notificationsExplainThenAsk() async {
        let m = model(FakeProfileService())
        await m.tapNotifications()
        #expect(m.prompt == .notificationsExplainer)
        _ = await m.confirm(.notificationsExplainer)
        #expect(permissions.notifications == .allowed)
        #expect(m.notificationsRow.value == "Allowed" && m.notificationsRow.action == nil)
    }

    @Test func notesWhenIOSKeepsLocationApproximate() {
        let m = model(FakeProfileService())
        #expect(m.locationDetailNote == nil)
        permissions.location = .whileUsing(precise: false)
        #expect(m.locationDetailNote == "Precise is off in Settings")
    }

    @Test func deleteAsksFirstThenDeletesEverything() async {
        let service = FakeProfileService()
        var deleted = false
        let m = model(service, onDeleted: { deleted = true })
        m.requestDelete()
        #expect(m.isConfirmingDelete && service.calls.isEmpty)
        await m.confirmDelete()
        #expect(service.calls == [.deleteAccount])
        #expect(deleted && !m.isDeleting && !m.isConfirmingDelete)
    }

    @Test func aFailedDeleteSaysWhyAndKeepsTheAccount() async {
        let service = FakeProfileService()
        service.nextError = .offline
        var deleted = false
        let m = model(service, onDeleted: { deleted = true })
        await m.confirmDelete()
        #expect(m.deleteError == .offline)
        #expect(!deleted && !m.isDeleting)
    }
}
