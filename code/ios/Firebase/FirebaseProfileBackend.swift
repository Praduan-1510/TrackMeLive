import FirebaseFirestore
import FirebaseFunctions
import Foundation
import TMLCore

/// The profile's wire on Firebase: a snapshot listener on `users/{uid}` (the owner may read it; no
/// client writes it), and the `saveProfile` and `deleteAccount` callables (Backend A's contract,
/// generated as `TMLSaveProfileRequest`/`Response` and `TMLDeleteAccountRequest`/`Response`).
@MainActor
public final class FirebaseProfileBackend: ProfileBackend {
    /// Makes a configured Firestore: once at start, and again after `clearLocalCache()` has
    /// terminated the old one (a terminated instance can't be used again).
    private let makeFirestore: @MainActor () -> Firestore
    private var firestore: Firestore
    private let functions: Functions

    init(makeFirestore: @escaping @MainActor () -> Firestore, functions: Functions) {
        self.makeFirestore = makeFirestore
        firestore = makeFirestore()
        self.functions = functions
    }

    public func profileUpdates(uid: String) -> AsyncStream<ProfileSnapshot> {
        let (stream, continuation) = AsyncStream.makeStream(of: ProfileSnapshot.self, bufferingPolicy: .bufferingNewest(1))
        // Firestore calls listeners on the main queue (its default dispatch queue). After an error it
        // stops the listener for good, so the stream ends too; ProfileStore listens again later.
        let registration = firestore.document(TMLPaths.user(userId: uid)).addSnapshotListener { snapshot, error in
            guard let update = Self.update(from: snapshot, error: error) else { return }
            continuation.yield(update)
            if case .failed = update { continuation.finish() }
        }
        let listener = Registration(registration)
        continuation.onTermination = { _ in listener.remove() }
        return stream
    }

    /// What a snapshot means for the store. A document missing from the cache says nothing yet: on a
    /// new phone offline, the server may still have the profile.
    private static func update(from snapshot: DocumentSnapshot?, error: (any Error)?) -> ProfileSnapshot? {
        if let error {
            return .failed(grpcError(error, details: nil, domain: FirestoreErrorDomain))
        }
        guard let snapshot else { return nil }
        guard snapshot.exists else { return snapshot.metadata.isFromCache ? nil : .missing }
        do {
            // Timestamps decode to Date. Only functions write users/{uid}, so nothing is pending.
            return .loaded(try snapshot.data(as: TMLUser.self, with: .estimate))
        } catch {
            return .failed(.failed)
        }
    }

    public func saveProfile(_ request: TMLSaveProfileRequest) async throws(ProfileError) -> TMLUser {
        let json = try await call(TMLCallable.saveProfile, with: request)
        do {
            return try TMLUser.decodeSaveProfileResponse(json)
        } catch {
            throw .failed
        }
    }

    public func deleteAccount() async throws(ProfileError) {
        // Idempotent on the server: a retry after a partial failure finishes the job.
        _ = try await call(TMLCallable.deleteAccount, with: TMLDeleteAccountRequest())
    }

    /// Terminates Firestore, clears its persisted cache, and starts a fresh instance. Listeners on the
    /// old instance end (the store has stopped listening by then). Failures are ignored: the cache
    /// is the device's, and a stale one is replaced at the next sign-in anyway.
    public func clearLocalCache() async {
        let old = firestore
        await withCheckedContinuation { continuation in
            old.terminate { _ in continuation.resume() }
        }
        await withCheckedContinuation { continuation in
            old.clearPersistence { _ in continuation.resume() }
        }
        firestore = makeFirestore()
    }

    /// Calls a callable with a Codable request; returns its result as JSON.
    private func call(_ name: String, with request: some Encodable & Sendable) async throws(ProfileError) -> Data {
        // A fresh Foundation object made here, so it can be handed to the SDK's task.
        let payload: Any
        do {
            payload = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request))
        } catch {
            throw .failed
        }
        do {
            let result = try await functions.httpsCallable(name).call(payload)
            return try JSONSerialization.data(withJSONObject: result.data, options: .fragmentsAllowed)
        } catch {
            let nsError = error as NSError
            throw Self.grpcError(error, details: nsError.userInfo[FunctionsErrorDetailsKey], domain: FunctionsErrorDomain)
        }
    }

    /// Firestore and Cloud Functions share the gRPC status codes; a URL error means offline.
    private static func grpcError(_ error: any Error, details: Any?, domain: String) -> ProfileError {
        let nsError = error as NSError
        if nsError.domain == domain { return .callable(code: nsError.code, details: details) }
        if nsError.domain == NSURLErrorDomain { return .offline }
        return .failed
    }
}

/// A Firestore listener to remove when its stream ends. `ListenerRegistration.remove()` is safe on
/// any thread, which is what lets this box cross into the termination handler.
private final class Registration: @unchecked Sendable {
    private let registration: any ListenerRegistration

    init(_ registration: any ListenerRegistration) {
        self.registration = registration
    }

    func remove() {
        registration.remove()
    }
}
