import Foundation

/// The signed-in sharer, as Firebase Authentication knows them.
public struct AuthUser: Hashable, Sendable {
    public let uid: String
    /// E.164. Only Firebase Authentication holds it (FSD §8); it never goes to Firestore.
    public let phoneNumber: String?

    public init(uid: String, phoneNumber: String?) {
        self.uid = uid
        self.phoneNumber = phoneNumber
    }
}

/// A code sent by text, waiting to be typed in.
public struct PhoneVerification: Hashable, Sendable {
    /// Firebase's verification ID for this text.
    public let id: String
    public let phoneNumber: PhoneNumber

    public init(id: String, phoneNumber: PhoneNumber) {
        self.id = id
        self.phoneNumber = phoneNumber
    }
}

/// Why sending or checking a code failed, in the terms the sign-up screen speaks.
public enum AuthError: Error, Hashable, Sendable {
    /// The number isn't one Auth can text.
    case invalidPhoneNumber
    /// The text couldn't be sent: offline, or anything else that may work on a retry.
    case sendFailed
    /// Too many codes or tries for this number or device; waiting helps.
    case tooManyRequests
    /// The code doesn't match.
    case wrongCode
    /// The code (or its verification) has expired; a new one is needed.
    case codeExpired
    /// The code couldn't be checked: offline, or a server error.
    case verifyFailed
    /// Signing out failed (Firebase keeps the user signed in).
    case signOutFailed
}

/// Phone-number sign-in (FSD §4 Sign up, §5): a 6-digit code by text, then a Firebase sign-in.
/// Implementations: `FakeAuthService` (TMLCore) and `FirebaseAuthService` (code/ios/Firebase).
@MainActor
public protocol AuthService: AnyObject {
    /// The signed-in user, restored at launch, or nil.
    var currentUser: AuthUser? { get }

    /// The signed-in user each time it changes, starting with the current one.
    func authStateChanges() -> AsyncStream<AuthUser?>

    /// Texts a code to the number.
    func sendCode(to phoneNumber: PhoneNumber) async throws(AuthError) -> PhoneVerification

    /// Checks the code and signs in.
    func verify(code: String, for verification: PhoneVerification) async throws(AuthError) -> AuthUser

    func signOut() throws(AuthError)
}

extension AuthError {
    /// Firebase Auth's `AuthErrorCode` raw values (firebase-ios-sdk, FirebaseAuth/Sources/Swift/Utilities/AuthErrors.swift).
    /// Kept here so the mapping is tested without the SDK.
    public enum FirebaseCode {
        public static let tooManyRequests = 17010
        public static let networkError = 17020
        public static let missingPhoneNumber = 17041
        public static let invalidPhoneNumber = 17042
        public static let missingVerificationCode = 17043
        public static let invalidVerificationCode = 17044
        public static let missingVerificationID = 17045
        public static let invalidVerificationID = 17046
        public static let sessionExpired = 17051
        public static let quotaExceeded = 17052
    }

    /// What a Firebase Auth error means while sending a code.
    public static func sending(firebaseCode code: Int) -> AuthError {
        switch code {
        case FirebaseCode.invalidPhoneNumber, FirebaseCode.missingPhoneNumber: .invalidPhoneNumber
        case FirebaseCode.tooManyRequests, FirebaseCode.quotaExceeded: .tooManyRequests
        default: .sendFailed
        }
    }

    /// What a Firebase Auth error means while checking a code.
    public static func verifying(firebaseCode code: Int) -> AuthError {
        switch code {
        case FirebaseCode.invalidVerificationCode, FirebaseCode.missingVerificationCode: .wrongCode
        case FirebaseCode.sessionExpired, FirebaseCode.invalidVerificationID, FirebaseCode.missingVerificationID: .codeExpired
        case FirebaseCode.tooManyRequests: .tooManyRequests
        default: .verifyFailed
        }
    }
}
