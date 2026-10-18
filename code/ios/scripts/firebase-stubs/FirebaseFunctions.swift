// Stub of FirebaseFunctions 12.19.2 (Swift module) used by code/ios/Firebase.
import Foundation
public let FunctionsErrorDomain: String = "com.firebase.functions"
public let FunctionsErrorDetailsKey: String = "details"
open class HTTPSCallableResult: NSObject { public let data: Any = NSNull() }
public final class HTTPSCallable: NSObject, Sendable {
    public func call(_ data: Any? = nil) async throws -> sending HTTPSCallableResult { HTTPSCallableResult() }
}
open class Functions: NSObject, @unchecked Sendable {
    open class func functions(region: String) -> Functions { Functions() }
    open func httpsCallable(_ name: String) -> HTTPSCallable { HTTPSCallable() }
    open func useEmulator(withHost host: String, port: Int) {}
}
