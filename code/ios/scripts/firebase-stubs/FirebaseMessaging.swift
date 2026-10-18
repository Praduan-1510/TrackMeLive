// Stub of the FirebaseMessaging surface used by code/ios/Firebase, from firebase-ios-sdk 12.19.2
// FirebaseMessaging/Sources/Public/FirebaseMessaging/FIRMessaging.h (ObjC: no Sendable), with its
// NS_SWIFT_NAME names and deprecations.
import Foundation
@objc public protocol MessagingDelegate: NSObjectProtocol {
    @available(*, deprecated, message: "Use messaging(_:didReceiveRegistration:) instead.")
    @objc optional func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?)
    @objc optional func messaging(_ messaging: Messaging, didReceiveRegistration installationId: String?)
}
open class Messaging: NSObject {
    open class func messaging() -> Messaging { Messaging() }
    weak open var delegate: MessagingDelegate?
    open var apnsToken: Data?
    @available(*, deprecated, message: "Use register(completion:) instead.")
    open func token(completion: @escaping (String?, Error?) -> Void) {}
    open func register(completion: @escaping (Error?) -> Void) {}
}
