import FirebaseAuth
import Foundation
import TMLCore

/// Phone sign-in through Firebase Authentication (FSD §5): `verifyPhoneNumber` texts the code, a
/// `PhoneAuthCredential` signs in. Errors are mapped to `AuthError` by TMLCore's tested mapping.
///
/// Everything runs on the main actor. Firebase Auth calls its completion handlers and state
/// listeners on the main thread (documented), and nothing non-Sendable leaves it: each callback
/// turns Firebase's objects into TMLCore's Sendable values before resuming.
@MainActor
public final class FirebaseAuthService: AuthService {
    private nonisolated static let errorDomain = "FIRAuthErrorDomain"

    private let auth: Auth

    init(auth: Auth) {
        self.auth = auth
    }

    public var currentUser: AuthUser? {
        auth.currentUser.map(AuthUser.init(firebase:))
    }

    public func authStateChanges() -> AsyncStream<AuthUser?> {
        let (stream, continuation) = AsyncStream.makeStream(of: AuthUser?.self, bufferingPolicy: .bufferingNewest(1))
        // Called at once with the current user, then on each change, always on the main thread.
        let handle = auth.addStateDidChangeListener { _, user in
            continuation.yield(user.map(AuthUser.init(firebase:)))
        }
        let listener = StateListener(auth: auth, handle: handle)
        continuation.onTermination = { _ in listener.remove() }
        return stream
    }

    public func sendCode(to phoneNumber: PhoneNumber) async throws(AuthError) -> PhoneVerification {
        let provider = PhoneAuthProvider.provider(auth: auth)
        let result: Result<String, AuthError> = await withCheckedContinuation { continuation in
            provider.verifyPhoneNumber(phoneNumber.e164, uiDelegate: nil) { verificationID, error in
                if let verificationID {
                    continuation.resume(returning: .success(verificationID))
                } else {
                    continuation.resume(returning: .failure(.sending(firebaseCode: Self.code(of: error))))
                }
            }
        }
        return PhoneVerification(id: try result.get(), phoneNumber: phoneNumber)
    }

    public func verify(code: String, for verification: PhoneVerification) async throws(AuthError) -> AuthUser {
        let credential = PhoneAuthProvider.provider(auth: auth)
            .credential(withVerificationID: verification.id, verificationCode: code)
        let result: Result<AuthUser, AuthError> = await withCheckedContinuation { continuation in
            auth.signIn(with: credential) { authResult, error in
                if let user = authResult?.user {
                    continuation.resume(returning: .success(AuthUser(firebase: user)))
                } else {
                    continuation.resume(returning: .failure(.verifying(firebaseCode: Self.code(of: error))))
                }
            }
        }
        return try result.get()
    }

    public func signOut() throws(AuthError) {
        do {
            try auth.signOut()
        } catch {
            throw .signOutFailed
        }
    }

    /// The `AuthErrorCode` of an Auth error; anything else (a URL error, say) maps to the generic case.
    private nonisolated static func code(of error: (any Error)?) -> Int {
        guard let error = error as NSError?, error.domain == errorDomain else { return -1 }
        return error.code
    }
}

extension AuthUser {
    init(firebase user: User) {
        self.init(uid: user.uid, phoneNumber: user.phoneNumber)
    }
}

/// An auth state listener to remove when its stream ends. `removeStateDidChangeListener` is safe on
/// any thread (it takes Auth's lock), which is what lets this box cross into the termination handler.
private final class StateListener: @unchecked Sendable {
    private let auth: Auth
    private let handle: any NSObjectProtocol

    init(auth: Auth, handle: any NSObjectProtocol) {
        self.auth = auth
        self.handle = handle
    }

    func remove() {
        auth.removeStateDidChangeListener(handle)
    }
}
