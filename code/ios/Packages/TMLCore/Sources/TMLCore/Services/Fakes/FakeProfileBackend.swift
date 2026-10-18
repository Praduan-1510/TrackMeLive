import Foundation

/// `users/{uid}` and `saveProfile` without a backend: what the app runs on in Sprint 1, and what the
/// tests drive. It checks requests the way the function does (the name rule, the accessory the
/// mascot takes) and acts for whoever `auth` has signed in.
@MainActor
public final class FakeProfileBackend: ProfileBackend {
    /// How long each call takes, so loading states show. Zero in tests.
    public var latency: Duration
    /// The next `saveProfile` fails with this, once.
    public var nextSaveError: ProfileError?
    /// The next `deleteAccount` fails with this, once.
    public var nextDeleteError: ProfileError?
    /// When set, the listener's first snapshot waits for `deliverPendingSnapshots()` (to test loading).
    public var holdsFirstSnapshot = false
    /// The next this-many listeners fail at once with `.offline`, as Firestore's do offline or refused.
    public var failingListens = 0
    /// How many listeners have been started.
    public private(set) var listenCount = 0
    /// How many times the local cache was cleared.
    public private(set) var cacheClears = 0
    /// Every request `saveProfile` received, in order.
    public private(set) var requests: [TMLSaveProfileRequest] = []

    private let auth: any AuthService
    private let defaults: UserDefaults?
    private let now: () -> Date
    private var profiles: [String: TMLUser]
    private var listeners: [UUID: (uid: String, continuation: AsyncStream<ProfileSnapshot>.Continuation)] = [:]
    private var held: [UUID] = []

    /// - Parameter defaults: where profiles survive a relaunch; nil keeps them in memory.
    public init(
        auth: any AuthService,
        defaults: UserDefaults? = nil,
        latency: Duration = .zero,
        profiles: [String: TMLUser] = [:],
        now: @escaping () -> Date = Date.init
    ) {
        self.auth = auth
        self.defaults = defaults
        self.latency = latency
        self.now = now
        if profiles.isEmpty, let data = defaults?.data(forKey: Self.storageKey),
           let stored = try? JSONDecoder().decode([String: TMLUser].self, from: data) {
            self.profiles = stored
        } else {
            self.profiles = profiles
        }
    }

    /// The stored profile for a uid, as the server has it.
    public func storedProfile(uid: String) -> TMLUser? { profiles[uid] }

    public func profileUpdates(uid: String) -> AsyncStream<ProfileSnapshot> {
        let (stream, continuation) = AsyncStream.makeStream(of: ProfileSnapshot.self, bufferingPolicy: .bufferingNewest(1))
        listenCount += 1
        if failingListens > 0 {
            failingListens -= 1
            continuation.yield(.failed(.offline))
            continuation.finish()
            return stream
        }
        let id = UUID()
        listeners[id] = (uid, continuation)
        if holdsFirstSnapshot {
            held.append(id)
        } else {
            continuation.yield(snapshot(uid))
        }
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor [weak self] in self?.listeners[id] = nil }
        }
        return stream
    }

    /// Sends a snapshot of your choosing to the uid's open listeners (a late or reordered one, say).
    public func deliver(_ snapshot: ProfileSnapshot, to uid: String) {
        for listener in listeners.values where listener.uid == uid {
            listener.continuation.yield(snapshot)
        }
    }

    /// Fails every open listener, as Firestore does on an error: one `.failed`, then nothing more.
    public func failActiveListeners(with error: ProfileError = .offline) {
        let open = listeners
        listeners = [:]
        held = []
        for listener in open.values {
            listener.continuation.yield(.failed(error))
            listener.continuation.finish()
        }
    }

    /// Sends the first snapshot to listeners held by `holdsFirstSnapshot`.
    public func deliverPendingSnapshots() {
        holdsFirstSnapshot = false
        for id in held {
            if let listener = listeners[id] { listener.continuation.yield(snapshot(listener.uid)) }
        }
        held = []
    }

    public func saveProfile(_ request: TMLSaveProfileRequest) async throws(ProfileError) -> TMLUser {
        await wait()
        requests.append(request)
        if let error = nextSaveError {
            nextSaveError = nil
            throw error
        }
        guard let uid = auth.currentUser?.uid else { throw .notSignedIn }
        guard case let .success(name) = PersonName.validate(request.name) else { throw .rejected(field: "name") }
        guard TMLMascotCatalog.takes(request.mascotId, request.mascotAccessory) else {
            throw .rejected(field: "mascot_accessory")
        }
        let time = now()
        let existing = profiles[uid]
        let stored = TMLUser(
            name: name,
            mascotId: request.mascotId,
            mascotColor: request.mascotColor,
            mascotAccessory: request.mascotAccessory,
            lastViewerName: existing?.lastViewerName,
            settings: request.settings ?? existing?.settings ?? .defaults,
            activeSessionId: existing?.activeSessionId,
            createdAt: existing?.createdAt ?? time,
            updatedAt: time
        )
        profiles[uid] = stored
        persist()
        notify(uid)
        return stored
    }

    public func deleteAccount() async throws(ProfileError) {
        await wait()
        if let error = nextDeleteError {
            nextDeleteError = nil
            throw error
        }
        guard let uid = auth.currentUser?.uid else { throw .notSignedIn }
        profiles[uid] = nil
        persist()
        notify(uid)
        // The real function deletes the Auth user too; signing out is the client's view of that.
        try? auth.signOut()
    }

    public func clearLocalCache() async {
        cacheClears += 1
    }

    private func snapshot(_ uid: String) -> ProfileSnapshot {
        profiles[uid].map(ProfileSnapshot.loaded) ?? .missing
    }

    private func notify(_ uid: String) {
        for (id, listener) in listeners where listener.uid == uid && !held.contains(id) {
            listener.continuation.yield(snapshot(uid))
        }
    }

    private func wait() async {
        guard latency > .zero else { return }
        try? await Task.sleep(for: latency)
    }

    private func persist() {
        guard let defaults, let data = try? JSONEncoder().encode(profiles) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    static let storageKey = "fake.profiles"
}

/// A `ProfileService` that records what it's asked, for the Mascot and Settings view-model tests.
@MainActor
public final class FakeProfileService: ProfileService {
    public enum Call: Hashable, Sendable {
        case name(String)
        case mascot(TMLMascotId, TMLMascotColor, TMLMascotAccessory?)
        case settings(TMLUserSettings)
        case deleteAccount
    }

    /// Every call, in order, failed ones included.
    public private(set) var calls: [Call] = []
    /// The next call fails with this, once.
    public var nextError: ProfileError?

    public init() {}

    public func save(name: String) async throws(ProfileError) { try record(.name(name)) }

    public func save(mascot: TMLMascotId, color: TMLMascotColor, accessory: TMLMascotAccessory?) async throws(ProfileError) {
        try record(.mascot(mascot, color, accessory))
    }

    public func save(settings: TMLUserSettings) async throws(ProfileError) { try record(.settings(settings)) }

    public func deleteAccount() async throws(ProfileError) { try record(.deleteAccount) }

    private func record(_ call: Call) throws(ProfileError) {
        calls.append(call)
        if let error = nextError {
            nextError = nil
            throw error
        }
    }
}
