import Foundation
import Testing
@testable import TMLCore

/// The app's flow from first launch to the tabs, and what survives a relaunch.
@MainActor
@Suite("Account flow")
struct AccountModelTests {
    /// One "install": the device's defaults, shared by every launch of it.
    final class Install {
        let scratch: ScratchDefaults
        var defaults: UserDefaults { scratch.defaults }

        init() throws { scratch = try ScratchDefaults() }

        /// A launch: fresh objects over the same stored state, as after the app is killed.
        @MainActor
        func launch() -> (AccountModel, FakeAuthService, FakeProfileBackend) {
            let auth = FakeAuthService(defaults: defaults)
            let backend = FakeProfileBackend(auth: auth, defaults: defaults)
            let account = AccountModel(
                auth: auth, profileBackend: backend, settings: UserDefaultsSettingsStore(defaults: defaults),
                region: { .us }
            )
            account.start()
            return (account, auth, backend)
        }
    }

    /// Onboarding's Skip, then sign-up through the code.
    func signUp(_ account: AccountModel, name: String = "Alex", number: String = "(415) 555-0142") async throws {
        if account.route == .onboarding { account.onboarding?.skip() }
        let signUp = try #require(account.signUp)
        signUp.updateName(name)
        signUp.updatePhone(number)
        signUp.submitDetails()
        await signUp.work?.value
        signUp.updateCode(FakeAuthService.demoCode)
        await signUp.work?.value
    }

    @Test func aFirstLaunchStartsAtOnboarding() throws {
        let (account, _, _) = try Install().launch()
        #expect(account.route == .onboarding)
        #expect(account.onboarding?.page == .share)
    }

    @Test func onboardingIsRememberedAcrossALaunch() throws {
        let install = try Install()
        let (first, _, _) = install.launch()
        first.onboarding?.advance()
        first.onboarding?.advance()
        first.onboarding?.advance() // Get started
        #expect(first.route == .signUp)

        let (second, _, _) = install.launch()
        #expect(second.route == .signUp)
    }

    @Test func backFromSignUpReturnsToTheLastOnboardingPage() throws {
        let (account, _, _) = try Install().launch()
        account.onboarding?.skip()
        account.leaveSignUp()
        #expect(account.route == .onboarding)
        #expect(account.onboarding?.page == .privacy)
    }

    @Test func aNewAccountGoesThroughTheMascotPickerToHome() async throws {
        let install = try Install()
        let (account, _, backend) = install.launch()
        try await signUp(account, name: " Alex ")
        #expect(account.route == .chooseMascot)
        #expect(account.signUp == nil)
        #expect(backend.requests == [.newAccount(name: "Alex")])
        #expect(account.profiles.profile?.name == "Alex")

        account.finishMascotSetup()
        #expect(account.route == .main)
    }

    @Test func signedInStateSurvivesARelaunch() async throws {
        let install = try Install()
        let (first, _, _) = install.launch()
        try await signUp(first)
        first.finishMascotSetup()

        let (second, auth, _) = install.launch()
        #expect(auth.currentUser?.phoneNumber == "+14155550142")
        #expect(await eventually { second.route == .main })
        #expect(second.profiles.profile?.name == "Alex")
    }

    /// Routing follows the server's profile: an account that left at the picker has its Fox, so the
    /// next launch goes Home.
    @Test func aRelaunchAfterSignUpGoesHomeWithTheDefaultFox() async throws {
        let install = try Install()
        let (first, _, _) = install.launch()
        try await signUp(first)
        #expect(first.route == .chooseMascot)

        let (second, _, _) = install.launch()
        #expect(await eventually { second.route == .main })
        #expect(second.profiles.profile?.mascotId == .fox)
        #expect(second.settings.hasChosenMascot)
    }

    /// iOS keeps Firebase's sign-in in the Keychain, which outlives a reinstall; UserDefaults doesn't.
    @Test func aSignInRestoredAfterAReinstallIsSignedOutFirst() async throws {
        let scratch = try ScratchDefaults() // a fresh install: no marker
        let keychainUser = AuthUser(uid: "old", phoneNumber: "+14155550142")
        let auth = FakeAuthService(signedIn: keychainUser)
        let backend = FakeProfileBackend(auth: auth, profiles: ["old": .sample()])
        let settings = UserDefaultsSettingsStore(defaults: scratch.defaults)
        let account = AccountModel(auth: auth, profileBackend: backend, settings: settings, region: { .us })
        account.start()
        #expect(auth.currentUser == nil)
        #expect(account.user == nil)
        #expect(account.route == .onboarding)
        #expect(settings.hasLaunchedBefore)
        #expect(backend.listenCount == 0)
    }

    /// With the marker (the same install), a signed-in account routes from its profile even if the
    /// device's flags were lost.
    @Test func aReadyProfileGoesHomeWhateverTheLocalFlagsSay() async {
        let user = AuthUser(uid: "u1", phoneNumber: "+14155550142")
        let auth = FakeAuthService(signedIn: user)
        let backend = FakeProfileBackend(auth: auth, profiles: ["u1": .sample(mascot: .neko)])
        let settings = InMemorySettingsStore(hasOnboarded: false, hasChosenMascot: false, hasLaunchedBefore: true)
        let account = AccountModel(auth: auth, profileBackend: backend, settings: settings, region: { .us })
        account.start()
        #expect(await eventually { account.route == .main })
        #expect(auth.currentUser == user)
        #expect(settings.hasChosenMascot)
        #expect(account.profiles.profile?.mascotId == .neko)
    }

    /// The code worked, the profile didn't: Back signs that number out, so a different number can't
    /// leave an orphaned account behind, and what was typed stays.
    @Test func backAfterAFailedAccountSignsOutAndKeepsTheDetails() async throws {
        let (account, auth, backend) = try Install().launch()
        backend.nextSaveError = .offline
        try await signUp(account, name: "Alex", number: "(415) 555-0142")
        let signUp = try #require(account.signUp)
        #expect(signUp.accountFailure == .offline)
        #expect(auth.currentUser != nil)

        #expect(signUp.goBack())
        #expect(auth.currentUser == nil)
        #expect(await eventually { account.user == nil })
        #expect(account.route == .signUp)
        #expect(account.signUp === signUp)
        #expect(signUp.step == .details && signUp.accountFailure == nil)
        #expect(signUp.name == "Alex")

        // A different number makes the one account.
        signUp.updatePhone("(415) 555-0199")
        signUp.submitDetails()
        await signUp.work?.value
        signUp.updateCode(FakeAuthService.demoCode)
        await signUp.work?.value
        #expect(account.route == .chooseMascot)
        #expect(backend.storedProfile(uid: FakeAuthService.uid(for: "+14155550142")) == nil)
        #expect(backend.storedProfile(uid: FakeAuthService.uid(for: "+14155550199")) != nil)
    }

    /// FSD §4: the same flow signs back in on a new phone and restores the profile; the typed name
    /// isn't sent, and the mascot picker is skipped.
    @Test func aReturningNumberOnANewPhoneIsRestored() async throws {
        let oldPhone = try Install()
        let (old, _, _) = oldPhone.launch()
        try await signUp(old, name: "Alex")
        try await old.profiles.save(mascot: .neko, color: .dusk, accessory: .glasses)

        // The new phone shares only the server: copy the stored profiles across.
        let newPhone = try Install()
        newPhone.defaults.set(oldPhone.defaults.data(forKey: FakeProfileBackend.storageKey), forKey: FakeProfileBackend.storageKey)
        let (account, _, backend) = newPhone.launch()
        try await signUp(account, name: "Someone else")
        #expect(account.route == .main)
        #expect(account.profiles.profile?.name == "Alex")
        #expect(account.profiles.profile?.mascotId == .neko)
        #expect(backend.requests.isEmpty)
        #expect(account.settings.hasChosenMascot)
    }

    @Test func signedInWithoutAProfileAsksForTheNameAgain() async throws {
        let install = try Install()
        let (first, auth, _) = install.launch()
        first.onboarding?.skip()
        // Killed between the code and the profile: signed in, nothing on the server.
        _ = try await auth.verify(code: FakeAuthService.demoCode, for: PhoneVerification(id: "v", phoneNumber: .alex))

        let (second, _, backend) = install.launch()
        #expect(await eventually { second.route == .signUp })
        let signUp = try #require(second.signUp)
        #expect(signUp.asksNameOnly)
        signUp.updateName("Alex")
        signUp.submitDetails()
        await signUp.work?.value
        #expect(second.route == .chooseMascot)
        #expect(backend.requests == [.newAccount(name: "Alex")])
    }

    @Test func backFromTheNameOnlyScreenSignsOut() async throws {
        let install = try Install()
        let (first, auth, _) = install.launch()
        first.onboarding?.skip()
        _ = try await auth.verify(code: FakeAuthService.demoCode, for: PhoneVerification(id: "v", phoneNumber: .alex))

        let (second, secondAuth, _) = install.launch()
        #expect(await eventually { second.signUp?.asksNameOnly == true })
        second.leaveSignUp()
        #expect(second.route == .signUp)
        #expect(second.signUp?.asksNameOnly == false)
        #expect(secondAuth.currentUser == nil)
    }

    @Test func deletingTheAccountStartsOverAtOnboarding() async throws {
        let install = try Install()
        let (account, auth, backend) = install.launch()
        try await signUp(account)
        account.finishMascotSetup()
        account.settings.appearance = .dark

        try await account.profiles.deleteAccount()
        #expect(account.route == .onboarding)
        #expect(account.user == nil)
        #expect(auth.currentUser == nil)
        #expect(backend.storedProfile(uid: FakeAuthService.uid(for: "+14155550142")) == nil)
        #expect(!account.settings.hasOnboarded && !account.settings.hasChosenMascot)
        // Appearance is the device's, not the account's.
        #expect(account.settings.appearance == .dark)

        let (relaunched, _, _) = install.launch()
        #expect(relaunched.route == .onboarding)
    }

    /// The server answers unauthenticated for a deleted, disabled or revoked account: sign out, keep
    /// only Appearance, and say why once on sign-up.
    @Test func anEndedSignInFromASaveSignsOutAndSaysWhy() async throws {
        let install = try Install()
        let (account, auth, backend) = install.launch()
        try await signUp(account)
        account.finishMascotSetup()
        account.settings.appearance = .dark

        backend.nextSaveError = .signInEnded
        await #expect(throws: ProfileError.signInEnded) { try await account.profiles.save(settings: .defaults) }
        #expect(account.route == .signUp)
        #expect(account.user == nil && auth.currentUser == nil)
        #expect(account.profiles.state == .idle)
        #expect(account.signUp?.notice == "Your sign-in has ended. Sign in again.")
        #expect(account.settings.hasOnboarded && !account.settings.hasChosenMascot)
        #expect(account.settings.appearance == .dark)
        #expect(await eventually { backend.cacheClears == 1 })

        // It stays until Send code, and the next sign-up screen doesn't repeat it.
        account.signUp?.submitDetails()
        #expect(account.signUp?.notice == nil)
        account.leaveSignUp()
        account.onboarding?.skip()
        #expect(account.signUp?.notice == nil)

        // A relaunch remembers the sign-out and the appearance.
        let (relaunched, _, _) = install.launch()
        #expect(relaunched.route == .signUp)
        #expect(relaunched.settings.appearance == .dark)
    }

    @Test func anEndedSignInFromTheListenerSignsOutWithoutRetrying() async throws {
        let (account, auth, backend) = try Install().launch()
        try await signUp(account)
        account.finishMascotSetup()
        let listens = backend.listenCount

        backend.failActiveListeners(with: .signInEnded)
        #expect(await eventually { account.route == .signUp })
        #expect(auth.currentUser == nil)
        #expect(account.signUp?.notice == ProfileError.signInEnded.message)
        #expect(!account.profiles.updatesUnavailable)
        #expect(backend.listenCount == listens)
    }

    @Test func anEndedSignInRightAfterTheCodeReturnsToTheDetailsSignedOut() async throws {
        let (account, auth, backend) = try Install().launch()
        account.onboarding?.skip()
        backend.nextSaveError = .signInEnded
        try await signUp(account)
        #expect(account.route == .signUp)
        #expect(account.signUp?.step == .details)
        #expect(account.signUp?.notice == ProfileError.signInEnded.message)
        #expect(auth.currentUser == nil)
    }

    @Test func signingOutAndDeletingClearTheLocalCache() async throws {
        let (account, auth, backend) = try Install().launch()
        try await signUp(account)
        account.finishMascotSetup()
        try auth.signOut()
        #expect(await eventually { backend.cacheClears == 1 })

        try await signUp(account)
        try await account.profiles.deleteAccount()
        #expect(await eventually { backend.cacheClears == 2 })
    }

    @Test func appearanceSurvivesARelaunch() throws {
        let install = try Install()
        let (first, _, _) = install.launch()
        first.settings.appearance = .dark
        let (second, _, _) = install.launch()
        #expect(second.settings.appearance == .dark)
        #expect(second.settings.appearance.colorScheme == .dark)
        #expect(AppearancePreference.system.colorScheme == nil)
    }

    @Test func signingOutElsewhereReturnsToSignUp() async throws {
        let (account, auth, _) = try Install().launch()
        try await signUp(account)
        account.finishMascotSetup()
        try auth.signOut()
        #expect(await eventually { account.route == .signUp })
        #expect(account.profiles.state == .idle)
    }

    @Test func aProfileThatCantLoadAtLaunchOffersTryAgain() async throws {
        let install = try Install()
        let (first, _, _) = install.launch()
        try await signUp(first)
        first.finishMascotSetup()

        // A backend whose listener fails once.
        let auth = FakeAuthService(defaults: install.defaults)
        let backend = FailingOnceBackend(wrapping: FakeProfileBackend(auth: auth, defaults: install.defaults))
        let account = AccountModel(auth: auth, profileBackend: backend, settings: UserDefaultsSettingsStore(defaults: install.defaults))
        account.start()
        #expect(await eventually { account.launchFailure == .offline })
        #expect(account.route == .launch)

        account.retryLaunch()
        #expect(await eventually { account.route == .main })
        #expect(account.launchFailure == nil)
    }
}

@MainActor
@Suite("Onboarding")
struct OnboardingModelTests {
    @Test func threePagesThenGetStarted() {
        var finished = 0
        let model = OnboardingModel { finished += 1 }
        #expect(model.pageCount == 3)
        #expect(model.showsSkip && model.continueTitle == "Continue")
        #expect(model.pagePosition == "Page 1 of 3")
        model.advance()
        #expect(model.page == .together)
        model.advance()
        #expect(model.page == .privacy)
        #expect(!model.showsSkip)
        #expect(model.continueTitle == "Get started")
        #expect(finished == 0)
        model.advance()
        #expect(finished == 1)
    }

    @Test func skipFinishesFromAnyPage() {
        var finished = false
        let model = OnboardingModel { finished = true }
        model.skip()
        #expect(finished)
    }
}

/// A backend whose first listener reports a failure, then behaves.
@MainActor
final class FailingOnceBackend: ProfileBackend {
    let wrapped: FakeProfileBackend
    private var failed = false

    init(wrapping wrapped: FakeProfileBackend) { self.wrapped = wrapped }

    func profileUpdates(uid: String) -> AsyncStream<ProfileSnapshot> {
        guard failed else {
            failed = true
            return AsyncStream { continuation in continuation.yield(.failed(.offline)) }
        }
        return wrapped.profileUpdates(uid: uid)
    }

    func saveProfile(_ request: TMLSaveProfileRequest) async throws(ProfileError) -> TMLUser {
        try await wrapped.saveProfile(request)
    }

    func deleteAccount() async throws(ProfileError) { try await wrapped.deleteAccount() }

    func clearLocalCache() async { await wrapped.clearLocalCache() }
}
