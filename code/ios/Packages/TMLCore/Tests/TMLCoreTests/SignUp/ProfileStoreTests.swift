import Foundation
import Testing
@testable import TMLCore

/// The profile store: the listener, optimistic changes with rollback, and the saveProfile wire.
@MainActor
@Suite("Profile store")
struct ProfileStoreTests {
    let uid = "u1"
    let auth: FakeAuthService
    let backend: FakeProfileBackend
    let store: ProfileStore

    init() {
        auth = FakeAuthService(signedIn: AuthUser(uid: "u1", phoneNumber: "+14155550142"))
        backend = FakeProfileBackend(auth: auth, profiles: ["u1": .sample()])
        store = ProfileStore(backend: backend)
    }

    @Test func loadsTheProfileFromTheListener() async {
        #expect(store.state == .idle)
        backend.holdsFirstSnapshot = true
        store.listen(uid: uid)
        #expect(store.state == .loading)
        backend.deliverPendingSnapshots()
        #expect(await store.resolvedState() == .ready(.sample()))
        #expect(store.profile?.name == "Alex")
    }

    @Test func anAccountWithoutAProfileIsMissing() async {
        store.listen(uid: "nobody")
        #expect(await store.resolvedState() == .missing)
        #expect(store.profile == nil)
    }

    @Test func signingOutForgetsTheProfile() async {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        store.listen(uid: nil)
        #expect(store.state == .idle)
        await #expect(throws: ProfileError.notSignedIn) { try await store.save(settings: .defaults) }
    }

    @Test func aChangeShowsAtOnceAndIsConfirmed() async throws {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        backend.latency = .milliseconds(30)

        let saving = Task { try await store.save(mascot: .robot, color: .dusk, accessory: .headlamp) }
        #expect(await eventually { store.profile?.mascotId == .robot })
        #expect(backend.storedProfile(uid: uid)?.mascotId == .fox) // not on the server yet
        try await saving.value
        #expect(backend.storedProfile(uid: uid)?.mascotId == .robot)
        #expect(store.profile?.mascotAccessory == .headlamp)
        #expect(store.profile?.mascotColor == .dusk)
    }

    @Test func aFailedChangeRollsBack() async {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        backend.nextSaveError = .offline
        var settings = TMLUserSettings.defaults
        settings.shareBack = false
        await #expect(throws: ProfileError.offline) { try await store.save(settings: settings) }
        #expect(store.profile?.settings.shareBack == true)
    }

    @Test func anAccessoryTheMascotCantWearIsRefusedBeforeSending() async {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        await #expect(throws: ProfileError.rejected(field: "mascot_accessory")) {
            try await store.save(mascot: .astronaut, color: .original, accessory: .glasses)
        }
        #expect(backend.requests.isEmpty)
        #expect(store.profile?.mascotId == .fox)
    }

    @Test func everySaveSendsTheWholeProfileAndSettingsOnlyWhenTheyChange() async throws {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        try await store.save(mascot: .neko, color: .rose, accessory: nil)
        var settings = TMLUserSettings.defaults
        settings.precision = .approximate
        try await store.save(settings: settings)
        try await store.save(name: "  Sam  ")

        #expect(backend.requests == [
            TMLSaveProfileRequest(name: "Alex", mascotId: .neko, mascotColor: .rose, mascotAccessory: nil, settings: nil),
            TMLSaveProfileRequest(name: "Alex", mascotId: .neko, mascotColor: .rose, mascotAccessory: nil, settings: settings),
            TMLSaveProfileRequest(name: "Sam", mascotId: .neko, mascotColor: .rose, mascotAccessory: nil, settings: nil),
        ])
        #expect(store.profile?.settings.precision == .approximate)
    }

    @Test func aBlankNameIsRefusedBeforeSending() async {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        await #expect(throws: ProfileError.rejected(field: "name")) { try await store.save(name: "   ") }
        #expect(backend.requests.isEmpty)
    }

    @Test func createsANewAccountWithTheDefaults() async throws {
        let newAuth = FakeAuthService(signedIn: AuthUser(uid: "new", phoneNumber: nil))
        let newBackend = FakeProfileBackend(auth: newAuth)
        let newStore = ProfileStore(backend: newBackend)
        newStore.listen(uid: "new")
        #expect(await newStore.resolvedState() == .missing)

        try await newStore.createProfile(name: " Alex ")
        #expect(newBackend.requests == [.newAccount(name: "Alex")])
        let profile = try #require(newStore.profile)
        #expect(profile.mascotId == .fox && profile.mascotColor == .original && profile.mascotAccessory == nil)
        #expect(profile.settings == .defaults)
    }

    @Test func aFailedCreationLeavesNoProfile() async {
        let newAuth = FakeAuthService(signedIn: AuthUser(uid: "new", phoneNumber: nil))
        let newBackend = FakeProfileBackend(auth: newAuth)
        let newStore = ProfileStore(backend: newBackend)
        newStore.listen(uid: "new")
        _ = await newStore.resolvedState()
        newBackend.nextSaveError = .offline
        await #expect(throws: ProfileError.offline) { try await newStore.createProfile(name: "Alex") }
        #expect(newStore.state == .missing)
    }

    @Test func aSnapshotDuringAChangeDoesntUndoItOnScreen() async throws {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        backend.latency = .milliseconds(30)
        let saving = Task { try await store.save(mascot: .ghost, color: .lagoon, accessory: nil) }
        #expect(await eventually { store.profile?.mascotId == .ghost })

        // Another device changes the settings meanwhile; its snapshot arrives first.
        backend.latency = .zero
        var settings = TMLUserSettings.defaults
        settings.alertExpiry = false
        _ = try await backend.saveProfile(TMLSaveProfileRequest(
            name: "Alex", mascotId: .fox, mascotColor: .original, mascotAccessory: nil, settings: settings))
        #expect(await eventually { store.profile?.settings.alertExpiry == false })
        #expect(store.profile?.mascotId == .ghost)

        try await saving.value
        #expect(await eventually { store.profile?.mascotId == .ghost })
    }

    /// Snapshots and save answers can arrive out of order; an older one never reverts the screen.
    @Test func aStaleSnapshotAfterASaveIsIgnored() async throws {
        store.listen(uid: uid)
        _ = await store.resolvedState() // updated_at 1000 s
        try await store.save(mascot: .neko, color: .rose, accessory: nil) // updated_at now
        #expect(store.profile?.mascotId == .neko)

        // The snapshot from before the save turns up late.
        backend.deliver(.loaded(.sample()), to: uid)
        for _ in 0..<20 { await Task.yield() }
        #expect(store.profile?.mascotId == .neko)

        // A newer one is taken.
        var newer = TMLUser.sample(mascot: .ghost)
        newer.updatedAt = Date().addingTimeInterval(60)
        backend.deliver(.loaded(newer), to: uid)
        #expect(await eventually { store.profile?.mascotId == .ghost })
    }

    @Test func aSaveAnswerOlderThanASnapshotIsIgnored() async throws {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        backend.latency = .milliseconds(30)
        let saving = Task { try await store.save(mascot: .robot, color: .moss, accessory: nil) }
        #expect(await eventually { store.profile?.mascotId == .robot })

        // Meanwhile a snapshot from a later write by another device arrives.
        var later = TMLUser.sample(mascot: .star)
        later.updatedAt = Date().addingTimeInterval(3600)
        backend.deliver(.loaded(later), to: uid)
        try await saving.value
        #expect(store.profile?.mascotId == .star)
    }

    @Test func deletingTheAccountTellsTheApp() async throws {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        var deleted = false
        store.onAccountDeleted = { deleted = true }
        try await store.deleteAccount()
        #expect(deleted)
        #expect(backend.storedProfile(uid: uid) == nil)
    }

    @Test func aFailedDeleteChangesNothing() async {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        var deleted = false
        store.onAccountDeleted = { deleted = true }
        backend.nextDeleteError = .offline
        await #expect(throws: ProfileError.offline) { try await store.deleteAccount() }
        #expect(!deleted)
        #expect(store.profile != nil)
    }
}

@Suite("The saveProfile wire")
struct SaveProfileWireTests {
    @Test func thePayloadAlwaysCarriesTheAccessoryAndOnlySometimesSettings() throws {
        let payload = try TMLSaveProfileRequest.newAccount(name: "Alex").callablePayload()
        #expect(Set(payload.keys) == ["name", "mascot_id", "mascot_color", "mascot_accessory"])
        #expect(payload["mascot_accessory"] is NSNull)
        #expect(payload["mascot_id"] as? String == "fox")
        #expect(payload["mascot_color"] as? String == "original")

        var settings = TMLUserSettings.defaults
        settings.defaultStop = .minutes15
        let withSettings = try TMLSaveProfileRequest(
            name: "Alex", mascotId: .robot, mascotColor: .moss, mascotAccessory: .headlamp, settings: settings
        ).callablePayload()
        #expect(withSettings["mascot_accessory"] as? String == "headlamp")
        let sent = try #require(withSettings["settings"] as? [String: Any])
        #expect(Set(sent.keys) == ["offer_on_call", "precision", "default_stop", "share_back",
                                   "alert_link_opened", "alert_call_ended", "alert_expiry"])
        #expect(sent["default_stop"] as? Int == 15)
    }

    @Test func theResponseDecodesWithEpochMilliseconds() throws {
        let json = """
        {"name":"Alex","mascot_id":"neko","mascot_color":"dusk","mascot_accessory":null,"last_viewer_name":"Mom",
         "settings":{"offer_on_call":true,"precision":"approximate","default_stop":"call","share_back":false,
                     "alert_link_opened":true,"alert_call_ended":true,"alert_expiry":false},
         "active_session_id":null,"created_at":1792300680000,"updated_at":1792300681500}
        """
        let user = try TMLUser.decodeSaveProfileResponse(Data(json.utf8))
        #expect(user.mascotId == .neko && user.mascotAccessory == nil)
        #expect(user.lastViewerName == "Mom")
        #expect(user.settings.precision == .approximate && user.settings.defaultStop == .call)
        #expect(user.createdAt == Date(timeIntervalSince1970: 1_792_300_680))
        #expect(user.updatedAt == Date(timeIntervalSince1970: 1_792_300_681.5))
    }
}

/// A clock the test moves by hand: each wait is recorded, and returns when the test says so.
@MainActor
final class ManualSleeper {
    private(set) var requested: [Duration] = []
    private var waiting: [CheckedContinuation<Void, Never>] = []

    /// The `sleep` to give the store.
    nonisolated var sleep: @Sendable (Duration) async throws -> Void {
        { [self] duration in await self.wait(duration) }
    }

    var pending: Int { waiting.count }

    private func wait(_ duration: Duration) async {
        requested.append(duration)
        await withCheckedContinuation { waiting.append($0) }
    }

    /// Ends the oldest wait.
    func advance() {
        guard !waiting.isEmpty else { return }
        waiting.removeFirst().resume()
    }

    /// Ends every wait, so none is left hanging when the test is over.
    func finish() {
        let all = waiting
        waiting = []
        for continuation in all { continuation.resume() }
    }
}

/// A failed Firestore listener stops for good; with a profile on screen the store listens again,
/// waiting longer each time, and says so once the first retry has failed too.
@MainActor
@Suite("Profile listener retries")
struct ProfileListenerRetryTests {
    let uid = "u1"
    let backend: FakeProfileBackend
    let sleeper = ManualSleeper()
    let store: ProfileStore

    init() {
        let auth = FakeAuthService(signedIn: AuthUser(uid: "u1", phoneNumber: "+14155550142"))
        backend = FakeProfileBackend(auth: auth, profiles: ["u1": .sample()])
        store = ProfileStore(backend: backend, sleep: sleeper.sleep)
    }

    @Test func retriesAfterTwoSecondsAndSaysNothingIfThatWorks() async {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        backend.failActiveListeners()
        #expect(await eventually { sleeper.pending == 1 })
        #expect(sleeper.requested == [.seconds(2)])
        // The profile stays on screen, and one failure isn't worth a note.
        #expect(store.profile?.name == "Alex")
        #expect(!store.updatesUnavailable)

        sleeper.advance()
        #expect(await eventually { backend.listenCount == 2 })
        #expect(!store.updatesUnavailable)
        #expect(store.profile?.name == "Alex")
        sleeper.finish()
    }

    @Test func aFailedRetryShowsTheNoteUntilASnapshotGetsThrough() async throws {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        backend.failingListens = 2
        backend.failActiveListeners()
        #expect(await eventually { sleeper.pending == 1 })
        #expect(!store.updatesUnavailable)

        sleeper.advance() // the first retry fails
        #expect(await eventually { store.updatesUnavailable })
        #expect(await eventually { sleeper.pending == 1 })
        sleeper.advance() // the second fails too
        #expect(await eventually { sleeper.requested.count == 3 })
        #expect(store.updatesUnavailable)

        // Meanwhile another device changes the name; the next retry gets through and brings it.
        _ = try await backend.saveProfile(.newAccount(name: "Sam"))
        sleeper.advance()
        #expect(await eventually { !store.updatesUnavailable })
        #expect(store.profile?.name == "Sam")
        #expect(sleeper.requested == [.seconds(2), .seconds(4), .seconds(8)])
        sleeper.finish()
    }

    @Test func theWaitDoublesAndStopsGrowingAtAMinute() async {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        // The open listener fails, then seven retries do: eight waits, and the ninth listener works.
        backend.failingListens = 7
        backend.failActiveListeners()
        for _ in 0..<8 {
            #expect(await eventually { sleeper.pending == 1 })
            sleeper.advance()
        }
        #expect(await eventually { backend.listenCount == 9 && !store.updatesUnavailable })
        #expect(sleeper.requested == [2, 4, 8, 16, 32, 60, 60, 60].map { Duration.seconds($0) })
        sleeper.finish()
    }

    @Test func signingOutStopsRetrying() async {
        store.listen(uid: uid)
        _ = await store.resolvedState()
        backend.failingListens = 1
        backend.failActiveListeners()
        #expect(await eventually { sleeper.pending == 1 })
        sleeper.advance()
        #expect(await eventually { store.updatesUnavailable && sleeper.pending == 1 })

        store.listen(uid: nil)
        #expect(!store.updatesUnavailable)
        sleeper.advance()
        // Give a stray retry the chance to run; none does.
        for _ in 0..<20 { await Task.yield() }
        #expect(backend.listenCount == 2)
        sleeper.finish()
    }

    @Test func withNothingOnScreenTheFailureIsTheLaunchScreens() async {
        backend.failingListens = 1
        store.listen(uid: uid)
        #expect(await store.resolvedState() == .failed(.offline))
        #expect(sleeper.requested.isEmpty)
        // Try again on the launch screen.
        store.reload()
        #expect(await store.resolvedState() == .ready(.sample()))
    }

    @Test func settingsShowsAQuietNoteWhileUpdatesFail() {
        let settings = SettingsModel(
            settings: .defaults, profile: FakeProfileService(), deviceSettings: InMemorySettingsStore(),
            permissions: FixedPermissionsService()
        )
        #expect(settings.profileUpdatesNote == nil)
        settings.profileUpdatesUnavailable = true
        #expect(settings.profileUpdatesNote == "Can\u{2019}t update your profile right now.")
    }

    @Test func theStandardPolicy() {
        let policy = ProfileStore.RetryPolicy.standard
        #expect((1...8).map(policy.delay(afterFailures:)) == [2, 4, 8, 16, 32, 60, 60, 60].map { Duration.seconds($0) })
        #expect(ProfileStore.RetryPolicy(delays: []).delay(afterFailures: 1) == .seconds(60))
    }
}
