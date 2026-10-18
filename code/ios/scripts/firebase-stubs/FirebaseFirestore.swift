// Stub of FirebaseFirestore 12.19.2 (ObjC + Swift Codable extension) used by code/ios/Firebase.
// Signatures copied from firebase-ios-sdk 12.19.2, Firestore/Source/Public/FirebaseFirestore/*.h
// (FIRDocumentReference, FIRWriteBatch, FIRCollectionReference, FIRFieldValue, FIRFirestoreSource),
// as Swift imports them: NS_SWIFT_NAME names, and an `async throws` twin for each completion method.
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
@objc public enum FirestoreSource: UInt { case `default`, server, cache }
open class FieldValue: NSObject {
    open class func serverTimestamp() -> Self { fatalError() }
    open class func delete() -> Self { fatalError() }
}
open class DocumentReference: NSObject, @unchecked Sendable {
    open func addSnapshotListener(_ listener: @escaping (DocumentSnapshot?, Error?) -> Void) -> ListenerRegistration {
        fatalError()
    }
    open func setData(_ documentData: [String: Any]) {}
    open func setData(_ documentData: [String: Any], completion: ((Error?) -> Void)? = nil) {}
    open func setData(_ documentData: [String: Any]) async throws {}
    open func delete() {}
    open func delete(completion: ((Error?) -> Void)? = nil) {}
    open func delete() async throws {}
    open func updateData(_ fields: [AnyHashable: Any]) {}
    open func updateData(_ fields: [AnyHashable: Any], completion: ((Error?) -> Void)? = nil) {}
    open func updateData(_ fields: [AnyHashable: Any]) async throws {}
    open func getDocument(source: FirestoreSource, completion: @escaping (DocumentSnapshot?, Error?) -> Void) {}
    open func getDocument(source: FirestoreSource) async throws -> DocumentSnapshot { DocumentSnapshot() }
}
open class CollectionReference: NSObject {
    open func document() -> DocumentReference { DocumentReference() }
    open func document(_ documentPath: String) -> DocumentReference { DocumentReference() }
}
open class WriteBatch: NSObject {
    @discardableResult
    open func setData(_ data: [String: Any], forDocument document: DocumentReference) -> WriteBatch { self }
    @discardableResult
    open func updateData(_ fields: [AnyHashable: Any], forDocument document: DocumentReference) -> WriteBatch { self }
    open func commit() {}
    open func commit(completion: ((Error?) -> Void)? = nil) {}
    open func commit() async throws {}
}
open class Firestore: NSObject {
    open class func firestore() -> Firestore { Firestore() }
    open func document(_ documentPath: String) -> DocumentReference { DocumentReference() }
    open func collection(_ collectionPath: String) -> CollectionReference { CollectionReference() }
    open func batch() -> WriteBatch { WriteBatch() }
    open func useEmulator(withHost host: String, port: Int) {}
    open func terminate(completion: ((Error?) -> Void)? = nil) {}
    open func clearPersistence(completion: ((Error?) -> Void)? = nil) {}
}
