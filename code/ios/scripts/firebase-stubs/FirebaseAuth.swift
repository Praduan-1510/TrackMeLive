// Stub of FirebaseAuth 12.19.2 (Swift module) signatures used by code/ios/Firebase.
import Foundation
import FirebaseCore
public protocol UserInfo: NSObjectProtocol { var uid: String { get } }
open class User: NSObject, UserInfo {
    public var uid: String { "" }
    open var phoneNumber: String? { nil }
}
open class AuthDataResult: NSObject { public let user: User = User() }
open class AuthCredential: NSObject {}
open class PhoneAuthCredential: AuthCredential {}
public protocol AuthUIDelegate: NSObjectProtocol {}
open class AuthSettings: NSObject, NSCopying { open var isAppVerificationDisabledForTesting: Bool = false; open func copy(with zone: NSZone? = nil) -> Any { AuthSettings() } }
public enum AuthAPNSTokenType: Int, Sendable { case unknown, sandbox, prod }
open class Auth: NSObject {
    open class func auth() -> Auth { Auth() }
    public var currentUser: User? { nil }
    @NSCopying open var settings: AuthSettings?
    open func useEmulator(withHost host: String, port: Int) {}
    open func signIn(with credential: AuthCredential, completion: ((AuthDataResult?, Error?) -> Void)? = nil) {}
    open func signOut() throws {}
    open func addStateDidChangeListener(_ listener: @escaping (Auth, User?) -> Void) -> NSObjectProtocol { NSObject() }
    open func removeStateDidChangeListener(_ listenerHandle: NSObjectProtocol) {}
    open func setAPNSToken(_ token: Data, type: AuthAPNSTokenType) {}
    open func canHandleNotification(_ userInfo: [AnyHashable: Any]) -> Bool { false }
    open func canHandle(_ url: URL) -> Bool { false }
}
open class PhoneAuthProvider: NSObject, @unchecked Sendable {
    open class func provider(auth: Auth) -> PhoneAuthProvider { PhoneAuthProvider() }
    open func verifyPhoneNumber(_ phoneNumber: String, uiDelegate: AuthUIDelegate? = nil,
                                completion: (@MainActor (String?, Error?) -> Void)?) {}
    open func verifyPhoneNumber(_ phoneNumber: String, uiDelegate: AuthUIDelegate? = nil,
                                multiFactorSession: NSObject? = nil) async throws -> String { "" }
    open func credential(withVerificationID verificationID: String, verificationCode: String) -> PhoneAuthCredential { PhoneAuthCredential() }
}
