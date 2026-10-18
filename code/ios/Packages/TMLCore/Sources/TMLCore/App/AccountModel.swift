import Foundation
import Observation

/// Who is using the app and which part of it they see: onboarding, sign-up, the new account's mascot
/// picker, or the tabs. It survives relaunch: the onboarded flag and Appearance in `SettingsStore`, the
/// sign-in in `AuthService`, the profile in `ProfileStore`.
@Observable
@MainActor
public final class AccountModel {
    public enum Route: Hashable, Sendable {
        /// Restoring the sign-in and the profile.
        case launch
        case onboarding
        case signUp
        /// A new account picks its mascot (the picker in onboarding mode), then Home.
        case chooseMascot
        /// Home, Mascot and Settings.
        case main
    }

    public private(set) var route: Route = .launch
    /// The signed-in user, or nil.
    public private(set) var user: AuthUser?
    /// The onboarding pages while `route` is `.onboarding`.
    public private(set) var onboarding: OnboardingModel?
    /// The sign-up flow while `route` is `.signUp`.
    public private(set) var signUp: SignUpModel?
    /// The profile couldn't be read at launch; the launch screen offers Try again.
    public private(set) var launchFailure: ProfileError?

    public let profiles: ProfileStore
    public let settings: any SettingsStore

    @ObservationIgnored private let auth: any AuthService
    @ObservationIgnored private let region: () -> PhoneRegion
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var authUpdates: Task<Void, Never>?
    @ObservationIgnored private var resolving: Task<Void, Never>?

    public init(
        auth: any AuthService,
        profileBackend: any ProfileBackend,
        settings: any SettingsStore,
        region: @escaping () -> PhoneRegion = { .defaultRegion() },
        now: @escaping () -> Date = Date.init
    ) {
        self.auth = auth
        self.settings = settings
        self.region = region
        self.now = now
        profiles = ProfileStore(backend: profileBackend)
        profiles.onAccountDeleted = { [weak self] in self?.accountDeleted() }
        profiles.onSignInEnded = { [weak self] in self?.signInEnded() }
    }

    /// Restores the session and follows sign-in changes. Call once, at launch.
    public func start() {
        guard authUpdates == nil else { return }
        // First launch of this install: a sign-in restored from the Keychain belongs to a deleted
        // install (maybe someone else's), so sign it out before anything routes on it.
        if !settings.hasLaunchedBefore {
            if auth.currentUser != nil { try? auth.signOut() }
            settings.hasLaunchedBefore = true
        }
        let updates = auth.authStateChanges()
        authUpdates = Task { [weak self] in
            for await user in updates {
                self?.authChanged(user)
            }
        }
        user = auth.currentUser
        if let user {
            profiles.listen(uid: user.uid)
            resolveSignedIn(user)
        } else {
            showSignedOut()
        }
    }

    // MARK: Moving through the flow

    /// Skip, or Get started on the last page.
    public func finishOnboarding() {
        settings.hasOnboarded = true
        onboarding = nil
        showSignUp(signedIn: nil)
    }

    /// Back from sign-up's first screen returns to onboarding's last page. When only the name was left
    /// (an interrupted sign-up), Back signs out instead, back to the whole details screen.
    public func leaveSignUp() {
        guard route == .signUp else { return }
        signUp = nil
        if user != nil {
            try? auth.signOut()
            user = nil
            profiles.listen(uid: nil)
            forgetCache()
            showSignUp(signedIn: nil)
        } else {
            showOnboarding(page: .privacy)
        }
    }

    /// The new account's mascot is saved (the picker's Continue).
    public func finishMascotSetup() {
        settings.hasChosenMascot = true
        if route == .chooseMascot { route = .main }
    }

    /// Try again on the launch screen.
    public func retryLaunch() {
        guard let user, launchFailure != nil else { return }
        launchFailure = nil
        profiles.reload()
        resolveSignedIn(user)
    }

    // MARK: Sign-up's last step

    /// After the code checks out: restore the profile if this number already has one (FSD §4, a new
    /// phone), otherwise create it with the typed name.
    func completeSignUp(user: AuthUser, name: String) async throws(ProfileError) -> SignUpOutcome {
        self.user = user
        if case .failed = profiles.state { profiles.reload() }
        profiles.listen(uid: user.uid)
        switch await profiles.resolvedState() {
        case .ready:
            return .restored
        case .missing:
            try await profiles.createProfile(name: name)
            return .created
        case let .failed(error):
            throw error
        case .idle, .loading:
            throw .failed
        }
    }

    private func signUpFinished(_ outcome: SignUpOutcome) {
        signUp = nil
        switch outcome {
        case .created:
            settings.hasChosenMascot = false
            route = .chooseMascot
        case .restored:
            // A returning account already has its mascot.
            settings.hasChosenMascot = true
            route = .main
        }
    }

    // MARK: Sign-in changes

    private func authChanged(_ newUser: AuthUser?) {
        guard newUser != user else { return }
        user = newUser
        guard let newUser else {
            // Signed out (or the account was deleted elsewhere).
            profiles.listen(uid: nil)
            forgetCache()
            // Already on sign-up's full details (Back from the code signed out): keep what's typed.
            if route == .signUp, let signUp, !signUp.asksNameOnly { return }
            showSignedOut()
            return
        }
        profiles.listen(uid: newUser.uid)
        // Sign-up finishes the account itself; only a sign-in from elsewhere needs resolving here.
        if route != .signUp { resolveSignedIn(newUser) }
    }

    private func resolveSignedIn(_ user: AuthUser) {
        route = .launch
        resolving?.cancel()
        resolving = Task { [weak self] in
            guard let self else { return }
            let state = await self.profiles.resolvedState()
            guard !Task.isCancelled, self.user == user else { return }
            switch state {
            case .ready:
                // Route from the server's profile, not the device's flags: every profile has its
                // mascot (Fox until one is picked), so a signed-in account with one goes Home.
                self.settings.hasChosenMascot = true
                self.route = .main
            case .missing:
                // Signed in, but the account was never finished: ask for the name again.
                self.showSignUp(signedIn: user)
            case let .failed(error):
                self.launchFailure = error
            case .idle, .loading:
                break
            }
        }
    }

    /// After Delete account: forget the account on this phone but keep Appearance (a device
    /// preference), sign out, stop the listener, clear Firestore's cache, and start over.
    private func accountDeleted() {
        settings.hasOnboarded = false
        settings.hasChosenMascot = false
        try? auth.signOut()
        user = nil
        profiles.listen(uid: nil)
        forgetCache()
        signUp = nil
        launchFailure = nil
        showOnboarding(page: .share)
    }

    /// The server ended the sign-in (the account was deleted, disabled or revoked elsewhere): sign out,
    /// forget everything local but Appearance, and return to sign-up, saying why once.
    private func signInEnded() {
        guard user != nil else { return }
        try? auth.signOut()
        user = nil
        profiles.listen(uid: nil)
        forgetCache()
        settings.hasChosenMascot = false
        settings.hasOnboarded = true
        signUp = nil
        launchFailure = nil
        showSignUp(signedIn: nil, notice: ProfileError.signInEnded.message)
    }

    /// Firestore's cache goes with the account, in the background.
    private func forgetCache() {
        let profiles = self.profiles
        Task { await profiles.clearLocalCache() }
    }

    private func showSignedOut() {
        signUp = nil
        launchFailure = nil
        if settings.hasOnboarded {
            showSignUp(signedIn: nil)
        } else {
            showOnboarding(page: .share)
        }
    }

    private func showOnboarding(page: OnboardingModel.Page) {
        onboarding = OnboardingModel(page: page) { [weak self] in self?.finishOnboarding() }
        route = .onboarding
    }

    private func showSignUp(signedIn user: AuthUser?, notice: String? = nil) {
        signUp = SignUpModel(
            auth: auth,
            region: region(),
            signedInUser: user,
            notice: notice,
            now: now,
            completeAccount: { [weak self] user, name throws(ProfileError) in
                guard let self else { throw .failed }
                return try await self.completeSignUp(user: user, name: name)
            },
            onFinished: { [weak self] outcome in self?.signUpFinished(outcome) }
        )
        route = .signUp
    }
}
