import Foundation

/// FCM and the device doc without a backend: tests, and the app on the fakes (where there's no
/// token, as on the Simulator, unless one is set).
@MainActor
public final class FakePushTokens: PushTokenBackend {
    public struct Saved: Hashable, Sendable {
        public let uid: String
        public let deviceId: String
        public let pushToken: String
    }

    /// What `pushToken()` answers.
    public var token: String?
    /// The next `saveDevice` fails with this, once.
    public var nextSaveError: ProfileError?
    /// Every device doc written, in order.
    public private(set) var saves: [Saved] = []
    /// Every device doc deleted, as (uid, deviceId).
    public private(set) var deletes: [String] = []
    private var continuations: [UUID: AsyncStream<String>.Continuation] = [:]

    public init(token: String? = nil) {
        self.token = token
    }

    public func pushToken() async -> String? { token }

    public func tokenUpdates() -> AsyncStream<String> {
        let (stream, continuation) = AsyncStream.makeStream(of: String.self)
        let id = UUID()
        continuations[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor [weak self] in self?.continuations[id] = nil }
        }
        return stream
    }

    /// FCM issues or refreshes the token.
    public func refresh(to token: String) {
        self.token = token
        for continuation in continuations.values { continuation.yield(token) }
    }

    public func saveDevice(uid: String, deviceId: String, pushToken: String) async throws(ProfileError) {
        if let error = nextSaveError {
            nextSaveError = nil
            throw error
        }
        saves.append(Saved(uid: uid, deviceId: deviceId, pushToken: pushToken))
    }

    public func deleteDevice(uid: String, deviceId: String) async throws(ProfileError) {
        deletes.append("\(uid)/\(deviceId)")
    }

    /// Open `tokenUpdates()` streams.
    public var listeners: Int { continuations.count }
}
