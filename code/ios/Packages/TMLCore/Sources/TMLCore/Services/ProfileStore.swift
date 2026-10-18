import Foundation
import Observation

/// The signed-in person's profile for the whole app: `users/{uid}` from the listener, with changes
/// shown at once.
///
/// Each change is applied on screen straight away, sent to `saveProfile` as the whole editable profile
/// (that callable never merges), and rolled back on its own if the call fails. A snapshot that arrives
/// while a change is in flight never undoes it on screen.
///
/// A Firestore listener stops for good when it fails. With a profile on screen the store listens
/// again after 2, 4, 8, 16, 32, then every 60 seconds, and once the first retry has failed too,
/// `updatesUnavailable` turns on (Settings says so) until a snapshot gets through.
@Observable
@MainActor
public final class ProfileStore: ProfileService {
    public enum State: Hashable, Sendable {
        /// Signed out.
        case idle
        /// Waiting for the first snapshot.
        case loading
        /// Signed in, and the server has no profile: the account is new, or its creation was interrupted.
        case missing
        case ready(TMLUser)
        case failed(ProfileError)
    }

    /// The profile as the app shows it, changes in flight included.
    public private(set) var state: State = .idle

    /// The profile once loaded, or nil.
    public var profile: TMLUser? {
        if case let .ready(user) = state { user } else { nil }
    }

    /// The listener has failed and so has its first retry: the profile on screen may be out of date.
    /// Saves still go straight to the server.
    public private(set) var updatesUnavailable = false

    /// How long to wait before listening again after the listener fails.
    public struct RetryPolicy: Hashable, Sendable {
        /// The waits after the first, second, … failure; the last one repeats.
        public var delays: [Duration]

        public init(delays: [Duration]) { self.delays = delays }

        /// 2, 4, 8, 16, 32, then every 60 seconds.
        public static let standard = RetryPolicy(delays: [2, 4, 8, 16, 32, 60].map { .seconds($0) })

        /// The wait after `failures` failures in a row (1 for the first).
        public func delay(afterFailures failures: Int) -> Duration {
            guard let last = delays.last else { return .seconds(60) }
            return delays.indices.contains(failures - 1) ? delays[failures - 1] : last
        }
    }

    /// Runs after `deleteAccount()` succeeds; the account model resets the app.
    @ObservationIgnored public var onAccountDeleted: (@MainActor () -> Void)?
    /// Runs when the server says the sign-in is over (`ProfileError.signInEnded`), from a save or the
    /// listener; the account model signs out.
    @ObservationIgnored public var onSignInEnded: (@MainActor () -> Void)?

    @ObservationIgnored private let backend: any ProfileBackend
    @ObservationIgnored private let retryPolicy: RetryPolicy
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private var uid: String?
    @ObservationIgnored private var listener: Task<Void, Never>?
    /// Counts listeners started, so a replaced one's late snapshots are ignored.
    @ObservationIgnored private var generation = 0
    /// The wait before listening again, after a failure.
    @ObservationIgnored private var retry: Task<Void, Never>?
    /// Listener failures since the last snapshot that got through.
    @ObservationIgnored private var consecutiveFailures = 0
    /// The last profile the server confirmed (snapshot or callable response).
    @ObservationIgnored private var confirmed: TMLUser?
    /// Changes sent and not yet answered, oldest first. Each is a whole profile, so the last one wins.
    @ObservationIgnored private var inFlight: [(id: Int, request: TMLSaveProfileRequest)] = []
    @ObservationIgnored private var nextChangeID = 0
    /// Delete account is running: every save is refused until it's done.
    @ObservationIgnored private var isDeleting = false
    /// A save has answered since the last snapshot with a profile in it.
    @ObservationIgnored private var savedSinceLastSnapshot = false
    @ObservationIgnored private var waiters: [CheckedContinuation<State, Never>] = []

    /// - Parameters:
    ///   - retryPolicy: the waits before listening again after a failure.
    ///   - sleep: how the waits are spent (tests pass a clock they control).
    public init(
        backend: any ProfileBackend,
        retryPolicy: RetryPolicy = .standard,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.backend = backend
        self.retryPolicy = retryPolicy
        self.sleep = sleep
    }

    // No deinit: the store lives as long as the app, and `listen(uid: nil)` ends the listener.

    // MARK: Listening

    /// Follows `users/{uid}`, or stops following when `uid` is nil (signed out).
    public func listen(uid: String?) {
        guard uid != self.uid else { return }
        listener?.cancel()
        listener = nil
        retry?.cancel()
        retry = nil
        self.uid = uid
        confirmed = nil
        inFlight = []
        savedSinceLastSnapshot = false
        consecutiveFailures = 0
        if updatesUnavailable { updatesUnavailable = false }
        guard let uid else {
            setState(.idle)
            return
        }
        setState(.loading)
        subscribe(uid)
    }

    private func subscribe(_ uid: String) {
        generation += 1
        let current = generation
        let updates = backend.profileUpdates(uid: uid)
        listener = Task { [weak self] in
            for await snapshot in updates {
                guard let self, self.generation == current else { return }
                self.receive(snapshot)
            }
            // The stream ended without a word (it shouldn't): don't leave anyone waiting.
            guard let self, self.generation == current, !Task.isCancelled, self.state == .loading else { return }
            self.setState(.failed(.failed))
        }
    }

    /// Listens again after a failure (Try again).
    public func reload() {
        guard let uid else { return }
        self.uid = nil
        listen(uid: uid)
    }

    /// The state once it's known: returns at once unless the first snapshot is still on its way.
    public func resolvedState() async -> State {
        guard state == .loading else { return state }
        return await withCheckedContinuation { waiters.append($0) }
    }

    private func receive(_ snapshot: ProfileSnapshot) {
        switch snapshot {
        case let .loaded(user):
            listenerRecovered()
            // Snapshots and save answers can arrive out of order: one older than what's confirmed
            // (by the server's updated_at) would revert the screen, so it's ignored.
            guard isCurrent(user) else { return }
            confirmed = user
            savedSinceLastSnapshot = false
            publish()
        case .missing:
            listenerRecovered()
            // While a profile is being created, or just was, a "missing" from before it is stale.
            guard inFlight.isEmpty, !savedSinceLastSnapshot else { return }
            confirmed = nil
            setState(.missing)
        case let .failed(error):
            if error == .signInEnded {
                onSignInEnded?()
                return
            }
            guard profile != nil else {
                // Nothing on screen yet: the launch screen (or sign-up) offers Try again (`reload()`).
                setState(.failed(error))
                return
            }
            // Keep the profile on screen and listen again after a while.
            consecutiveFailures += 1
            if consecutiveFailures >= 2, !updatesUnavailable { updatesUnavailable = true }
            scheduleRetry()
        }
    }

    private func scheduleRetry() {
        guard let uid else { return }
        // The failed listener is over; ignore anything else it says.
        generation += 1
        listener?.cancel()
        listener = nil
        retry?.cancel()
        let delay = retryPolicy.delay(afterFailures: consecutiveFailures)
        let sleep = self.sleep
        retry = Task { [weak self] in
            do {
                try await sleep(delay)
            } catch {
                return
            }
            guard let self, !Task.isCancelled, self.uid == uid else { return }
            self.retry = nil
            self.subscribe(uid)
        }
    }

    private func listenerRecovered() {
        consecutiveFailures = 0
        if updatesUnavailable { updatesUnavailable = false }
    }

    // MARK: ProfileService

    public func save(name: String) async throws(ProfileError) {
        guard case let .success(tidy) = PersonName.validate(name) else { throw .rejected(field: "name") }
        try await change(settingsChanged: false) { $0.name = tidy }
    }

    public func save(mascot: TMLMascotId, color: TMLMascotColor, accessory: TMLMascotAccessory?) async throws(ProfileError) {
        // The server refuses an accessory the character can't wear; say so before sending.
        guard TMLMascotCatalog.takes(mascot, accessory) else { throw .rejected(field: "mascot_accessory") }
        try await change(settingsChanged: false) {
            $0.mascotId = mascot
            $0.mascotColor = color
            $0.mascotAccessory = accessory
        }
    }

    public func save(settings: TMLUserSettings) async throws(ProfileError) {
        try await change(settingsChanged: true) { $0.settings = settings }
    }

    public func deleteAccount() async throws(ProfileError) {
        guard uid != nil, !isDeleting else { throw .notSignedIn }
        // Nothing may write between the delete and the sign-out: a saveProfile in that window would
        // recreate users/{uid} for an account that no longer exists.
        isDeleting = true
        do {
            try await backend.deleteAccount()
        } catch {
            isDeleting = false
            signInEnded(by: error)
            throw error
        }
        isDeleting = false
        onAccountDeleted?()
    }

    /// Creates the profile for a new account: Fox, original color, no accessory, default settings.
    public func createProfile(name: String) async throws(ProfileError) {
        guard uid != nil, !isDeleting else { throw .notSignedIn }
        guard case let .success(tidy) = PersonName.validate(name) else { throw .rejected(field: "name") }
        let request = TMLSaveProfileRequest.newAccount(name: tidy)
        let id = begin(request)
        do {
            let stored = try await backend.saveProfile(request)
            finish(id, stored: stored)
        } catch {
            fail(id)
            signInEnded(by: error)
            throw error
        }
    }

    // MARK: Changes

    private func change(settingsChanged: Bool, _ edit: (inout TMLUser) -> Void) async throws(ProfileError) {
        guard uid != nil, !isDeleting else { throw .notSignedIn }
        guard var user = profile else { throw .notSignedIn }
        edit(&user)
        let request = TMLSaveProfileRequest(user: user, includeSettings: settingsChanged)
        let id = begin(request)
        do {
            let stored = try await backend.saveProfile(request)
            finish(id, stored: stored)
        } catch {
            fail(id)
            signInEnded(by: error)
            throw error
        }
    }

    private func signInEnded(by error: ProfileError) {
        if error == .signInEnded { onSignInEnded?() }
    }

    /// Forgets the device's cached copy of the account (after a sign-out or a delete).
    public func clearLocalCache() async {
        await backend.clearLocalCache()
    }

    private func begin(_ request: TMLSaveProfileRequest) -> Int {
        nextChangeID += 1
        inFlight.append((nextChangeID, request))
        publish()
        return nextChangeID
    }

    private func finish(_ id: Int, stored: TMLUser) {
        inFlight.removeAll { $0.id == id }
        // The callable's answer is the server's truth until the next snapshot, unless a newer
        // snapshot already came in.
        if isCurrent(stored) {
            confirmed = stored
            savedSinceLastSnapshot = true
        }
        publish()
    }

    /// Not older than the confirmed profile. Equal counts: the same write seen twice, as a snapshot
    /// and as a save's answer (whose epoch milliseconds may be truncated below the snapshot's).
    private func isCurrent(_ user: TMLUser) -> Bool {
        guard let confirmed else { return true }
        return user.updatedAt >= confirmed.updatedAt.addingTimeInterval(-0.001)
    }

    private func fail(_ id: Int) {
        inFlight.removeAll { $0.id == id }
        publish()
    }

    /// The confirmed profile with the changes still in flight on top.
    private func publish() {
        guard uid != nil else { return }
        if let base = confirmed {
            setState(.ready(inFlight.reduce(base) { $0.applying($1.request) }))
        } else if let creating = inFlight.last?.request {
            // Creating a new account: show it before the server has answered.
            let now = Date()
            setState(.ready(TMLUser(
                name: creating.name, mascotId: creating.mascotId, mascotColor: creating.mascotColor,
                mascotAccessory: creating.mascotAccessory, settings: creating.settings ?? .defaults,
                createdAt: now, updatedAt: now
            )))
        } else if case .ready = state {
            // A failed creation: back to no profile.
            setState(.missing)
        }
    }

    private func setState(_ new: State) {
        if state != new { state = new }
        guard new != .loading, !waiters.isEmpty else { return }
        let ready = waiters
        waiters = []
        for waiter in ready { waiter.resume(returning: new) }
    }
}
