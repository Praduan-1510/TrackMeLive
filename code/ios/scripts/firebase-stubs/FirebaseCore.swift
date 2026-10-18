// Stub of the FirebaseCore surface used by code/ios/Firebase, from firebase-ios-sdk 12.19.2 headers (ObjC: no Sendable).
import Foundation
open class FirebaseOptions: NSObject {
    public init(googleAppID: String, gcmSenderID: String) {}
    open var apiKey: String?
    open var projectID: String?
}
open class FirebaseApp: NSObject {
    open class func configure(options: FirebaseOptions) {}
    open class func app() -> FirebaseApp? { nil }
}
