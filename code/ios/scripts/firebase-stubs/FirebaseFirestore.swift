// Stub of FirebaseFirestore 12.19.2 (ObjC + Swift Codable extension) used by code/ios/Firebase.
import Foundation
public let FirestoreErrorDomain: String = "FIRFirestoreErrorDomain"
public enum ServerTimestampBehavior: Int { case none, estimate, previous }
public final class SnapshotMetadata: NSObject, @unchecked Sendable { public var isFromCache: Bool { false } }
public protocol ListenerRegistration: NSObjectProtocol { func remove() }
open class DocumentSnapshot: NSObject {
    open var exists: Bool { false }
    open var metadata: SnapshotMetadata { SnapshotMetadata() }
    open func data(with behavior: ServerTimestampBehavior) -> [String: Any]? { nil }
}
public extension DocumentSnapshot {
    func data<T: Decodable>(as type: T.Type, with serverTimestampBehavior: ServerTimestampBehavior = .none) throws -> T {
        throw NSError(domain: FirestoreErrorDomain, code: 0)
    }
}
open class DocumentReference: NSObject, @unchecked Sendable {
    open func addSnapshotListener(_ listener: @escaping (DocumentSnapshot?, Error?) -> Void) -> ListenerRegistration {
        fatalError()
    }
}
open class Firestore: NSObject {
    open class func firestore() -> Firestore { Firestore() }
    open func document(_ documentPath: String) -> DocumentReference { DocumentReference() }
    open func useEmulator(withHost host: String, port: Int) {}
    open func terminate(completion: ((Error?) -> Void)? = nil) {}
    open func clearPersistence(completion: ((Error?) -> Void)? = nil) {}
}
