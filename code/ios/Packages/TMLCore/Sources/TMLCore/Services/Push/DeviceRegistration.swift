import Foundation

/// The push token's wire: FCM's registration token, and `users/{uid}/devices/{deviceId}` (FSD §6;
/// Backend-Alerts' contract). Implementations: `FakePushTokens` (TMLCore), `FirebasePushTokens`
/// (code/ios/Firebase, FirebaseMessaging).
@MainActor
public protocol PushTokenBackend: AnyObject {
    /// The FCM registration token, or nil when there's none yet (the Simulator, no APNs token, or
    /// offline). Never throws: no token is an ordinary state.
    func pushToken() async -> String?
    /// New tokens as FCM issues or refreshes them, until the stream is dropped.
    func tokenUpdates() -> AsyncStream<String>
    /// Writes the device doc: exactly `{platform: "ios", push_token, live_activity_start_token:
    /// null, updated_at: server time}`. The rules accept it only once the profile exists.
    func saveDevice(uid: String, deviceId: String, pushToken: String) async throws(ProfileError)
    /// Deletes the device doc.
    func deleteDevice(uid: String, deviceId: String) async throws(ProfileError)
}

/// Keeps this phone's `users/{uid}/devices/{deviceId}` current, so alerts reach it (FSD §6, §8):
/// written once the profile exists, again on every launch and whenever FCM refreshes the token
/// (docs not rewritten for 270 days are deleted), and deleted before a sign-out.
///
/// It never gets in the way: no token yet means no doc yet, and a failed write waits for the next
/// token or launch. Nothing about sharing waits for it.
@MainActor
public final class DeviceRegistrar {
    static let deviceIdKey = "device.id"

    /// A UUID made once per install (x-decisions Q-DEVICE-ID). UserDefaults goes with the app, so a
    /// reinstall is a new device; the old doc expires.
    public let deviceId: String
    /// The uid and token last written, this launch.
    public private(set) var saved: (uid: String, token: String)?

    private let backend: any PushTokenBackend
    private var uid: String?
    private var task: Task<Void, Never>?

    public init(backend: any PushTokenBackend, defaults: UserDefaults = .standard) {
        self.backend = backend
        if let stored = defaults.string(forKey: Self.deviceIdKey), UUID(uuidString: stored) != nil {
            deviceId = stored
        } else {
            deviceId = UUID().uuidString
            defaults.set(deviceId, forKey: Self.deviceIdKey)
        }
    }

    /// Signed in and the profile exists: on every launch, and after sign-up creates it. Writes the
    /// doc with the current token, then again with each new one. Calling it again for the same
    /// account does nothing.
    public func profileReady(uid: String) {
        guard self.uid != uid else { return }
        self.uid = uid
        task?.cancel()
        let backend = backend
        // Listen before asking, so a token issued in between isn't missed.
        let updates = backend.tokenUpdates()
        task = Task { [weak self] in
            if let token = await backend.pushToken() { await self?.save(token, for: uid) }
            for await token in updates {
                await self?.save(token, for: uid)
            }
        }
    }

    /// Before signing out: the doc is deleted while the sign-in still lets it be. Waits for the
    /// server; a failure is ignored (the doc expires, and the server drops dead tokens).
    public func willSignOut() async {
        let uid = uid
        stop()
        guard let uid else { return }
        try? await backend.deleteDevice(uid: uid, deviceId: deviceId)
    }

    /// The account is gone (deleted, or its sign-in ended elsewhere): the server has removed or
    /// will remove the doc, so just stop.
    public func stop() {
        task?.cancel()
        task = nil
        uid = nil
        saved = nil
    }

    private func save(_ token: String, for uid: String) async {
        guard self.uid == uid, !token.isEmpty, saved?.uid != uid || saved?.token != token else { return }
        do {
            try await backend.saveDevice(uid: uid, deviceId: deviceId, pushToken: token)
            if self.uid == uid { saved = (uid, token) }
        } catch {
            // The next token or launch tries again.
        }
    }
}

/// An alert the server sends (Backend-Alerts' contract): APNs, `thread-id` the session id, with
/// `type` and `session_id` at the top of `userInfo`.
public enum PushAlert: Hashable, Sendable {
    /// The link was opened for the first time (FSD §4 View notification); collapse id
    /// `link_opened:{session_id}`.
    case linkOpened(sessionId: String)

    /// Nil for anything that isn't one of ours (or a type this version doesn't know).
    public init?(userInfo: [AnyHashable: Any]) {
        guard let type = userInfo["type"] as? String,
              let sessionId = userInfo["session_id"] as? String, !sessionId.isEmpty else { return nil }
        switch type {
        case "link_opened": self = .linkOpened(sessionId: sessionId)
        default: return nil
        }
    }

    public var sessionId: String {
        switch self {
        case .linkOpened(let sessionId): sessionId
        }
    }

    /// Where a tap goes: the live screen while the alert's share is still the one running,
    /// otherwise Home.
    public func opensLive(activeSessionId: String?) -> Bool { activeSessionId == sessionId }
}
