import Foundation

/// Phone sign-in without a backend: what the app runs on until the Firebase SDK is in (Sprint 1), and
/// what the tests drive.
///
/// The demo values, also in code/ios/README.md:
/// - The code is 482913. 000000 acts as an expired code; any other code is wrong.
/// - A number ending in 0000 is refused as invalid, one ending in 9999 fails to send once (then works),
///   and one ending in 8888 hits the rate limit.
/// - The same number always signs in as the same user, so its profile comes back.
@MainActor
public final class FakeAuthService: AuthService {
    public static let demoCode = "482913"
    public static let expiredCode = "000000"

    /// How long each call takes, so loading states show. Zero in tests.
    public var latency: Duration
    /// The next `sendCode` fails with this, once.
    public var nextSendError: AuthError?
    /// The next `verify` fails with this, once.
    public var nextVerifyError: AuthError?
    /// Every number a code was sent to, in order.
    public private(set) var sentCodes: [PhoneNumber] = []

    public private(set) var currentUser: AuthUser? {
        didSet {
            persist()
            for continuation in observers.values { continuation.yield(currentUser) }
        }
    }

    private let defaults: UserDefaults?
    private var observers: [UUID: AsyncStream<AuthUser?>.Continuation] = [:]
    private var failedOnce: Set<String> = []
    private var nextVerificationID = 0

    /// - Parameter defaults: where the signed-in user survives a relaunch; nil keeps it in memory.
    public init(defaults: UserDefaults? = nil, latency: Duration = .zero, signedIn user: AuthUser? = nil) {
        self.defaults = defaults
        self.latency = latency
        if let user {
            currentUser = user
        } else if let stored = defaults?.dictionary(forKey: Self.storageKey),
                  let uid = stored["uid"] as? String {
            currentUser = AuthUser(uid: uid, phoneNumber: stored["phone"] as? String)
        }
    }

    public func authStateChanges() -> AsyncStream<AuthUser?> {
        let (stream, continuation) = AsyncStream.makeStream(of: AuthUser?.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        observers[id] = continuation
        continuation.yield(currentUser)
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor [weak self] in self?.observers[id] = nil }
        }
        return stream
    }

    public func sendCode(to phoneNumber: PhoneNumber) async throws(AuthError) -> PhoneVerification {
        await wait()
        if let error = nextSendError {
            nextSendError = nil
            throw error
        }
        let number = phoneNumber.nationalNumber
        if number.hasSuffix("0000") { throw .invalidPhoneNumber }
        if number.hasSuffix("8888") { throw .tooManyRequests }
        if number.hasSuffix("9999"), failedOnce.insert(phoneNumber.e164).inserted { throw .sendFailed }
        sentCodes.append(phoneNumber)
        nextVerificationID += 1
        return PhoneVerification(id: "fake-verification-\(nextVerificationID)", phoneNumber: phoneNumber)
    }

    public func verify(code: String, for verification: PhoneVerification) async throws(AuthError) -> AuthUser {
        await wait()
        if let error = nextVerifyError {
            nextVerifyError = nil
            throw error
        }
        if code == Self.expiredCode { throw .codeExpired }
        guard code == Self.demoCode else { throw .wrongCode }
        let e164 = verification.phoneNumber.e164
        let user = AuthUser(uid: Self.uid(for: e164), phoneNumber: e164)
        currentUser = user
        return user
    }

    public func signOut() throws(AuthError) {
        currentUser = nil
    }

    /// The uid a number signs in as: the same every time.
    public static func uid(for e164: String) -> String {
        "fake-" + e164.filter(\.isNumber)
    }

    private func wait() async {
        guard latency > .zero else { return }
        try? await Task.sleep(for: latency)
    }

    private func persist() {
        guard let defaults else { return }
        if let currentUser {
            var stored: [String: String] = ["uid": currentUser.uid]
            stored["phone"] = currentUser.phoneNumber
            defaults.set(stored, forKey: Self.storageKey)
        } else {
            defaults.removeObject(forKey: Self.storageKey)
        }
    }

    static let storageKey = "fake.auth.user"
}
