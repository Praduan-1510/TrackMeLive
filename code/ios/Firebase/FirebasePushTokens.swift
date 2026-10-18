import FirebaseFirestore
import FirebaseMessaging
import Foundation
import TMLCore

/// The push token on Firebase (Backend-Alerts' device contract): FCM's registration token, and
/// `users/{uid}/devices/{deviceId}` in Firestore.
///
/// The app delegate hands APNs' token over (`FirebaseServices.didRegisterForRemoteNotifications`,
/// since `FirebaseAppDelegateProxyEnabled` is off); FCM then issues its token and calls the delegate.
/// On the Simulator, or before APNs answers, there's no token: `pushToken()` returns nil.
///
/// The backend sends to the FCM registration token, so this uses `token(completion:)` and
/// `messaging(_:didReceiveRegistrationToken:)`, which 12.19.2 marks deprecated in favor of
/// installation-ID registration (`register(completion:)`); moving to that is a backend change.
@MainActor
public final class FirebasePushTokens: NSObject, PushTokenBackend, MessagingDelegate {
    private let firestore: @MainActor () -> Firestore
    private let messaging: Messaging
    private var continuations: [UUID: AsyncStream<String>.Continuation] = [:]

    init(firestore: @escaping @MainActor () -> Firestore, messaging: Messaging) {
        self.firestore = firestore
        self.messaging = messaging
        super.init()
        messaging.delegate = self
    }

    /// APNs' device token, from the app delegate.
    func setAPNSToken(_ deviceToken: Data) {
        messaging.apnsToken = deviceToken
    }

    public func pushToken() async -> String? {
        // Fails without an APNs token (the Simulator) or offline: no token yet.
        await withCheckedContinuation { continuation in
            messaging.token { token, _ in continuation.resume(returning: token) }
        }
    }

    public func tokenUpdates() -> AsyncStream<String> {
        let (stream, continuation) = AsyncStream.makeStream(of: String.self)
        let id = UUID()
        continuations[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor [weak self] in self?.continuations[id] = nil }
        }
        return stream
    }

    public func saveDevice(uid: String, deviceId: String, pushToken: String) async throws(ProfileError) {
        typealias Field = TMLDevice.Field
        let device: [String: Any] = [
            Field.platform.rawValue: TMLDevicePlatform.ios.rawValue,
            Field.pushToken.rawValue: pushToken,
            // Sprint 3: the Live Activity push-to-start token.
            Field.liveActivityStartToken.rawValue: NSNull(),
            Field.updatedAt.rawValue: FieldValue.serverTimestamp(),
        ]
        do {
            try await firestore().document(TMLPaths.device(userId: uid, deviceId: deviceId)).setData(device)
        } catch {
            throw Self.error(error)
        }
    }

    public func deleteDevice(uid: String, deviceId: String) async throws(ProfileError) {
        do {
            try await firestore().document(TMLPaths.device(userId: uid, deviceId: deviceId)).delete()
        } catch {
            throw Self.error(error)
        }
    }

    // MARK: MessagingDelegate

    nonisolated public func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken, !fcmToken.isEmpty else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            for continuation in continuations.values { continuation.yield(fcmToken) }
        }
    }

    private static func error(_ error: any Error) -> ProfileError {
        let nsError = error as NSError
        if nsError.domain == FirestoreErrorDomain { return .callable(code: nsError.code, details: nil) }
        return nsError.domain == NSURLErrorDomain ? .offline : .failed
    }
}
