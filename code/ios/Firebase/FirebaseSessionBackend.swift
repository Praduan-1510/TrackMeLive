import FirebaseCore
import FirebaseFirestore
import FirebaseFunctions
import Foundation
import TMLCore

/// The share session's wire on Firebase (FSD §5, §6; Backend's contract, generated as
/// `TMLCreateSessionRequest`/`Response`, `TMLStopSessionRequest`/`Response`,
/// `TMLDiscardSessionRequest`, `TMLShareSession` and `TMLPing`):
/// - the `createSession`, `stopSession` and `discardSession` callables;
/// - a snapshot listener on `shareSessions/{id}` (the owner may read it);
/// - the sharer's own writes, the only session fields the rules let the app touch
///   (x-decisions Q-SESSION-CALLABLES): the stop rule fields, `precision_next`, and each ping in one
///   batch with its check-in and `last_fix_at` (x-decisions Q-PING-WRITE).
///
/// Firestore holds writes while offline and answers once the server has them, so a write's
/// `await` returns only then; the ping uploader relies on that to keep one write in flight.
@MainActor
public final class FirebaseSessionBackend: SessionBackend {
    /// The Firestore in use: `FirebaseProfileBackend` replaces it after clearing the local cache.
    private let firestore: @MainActor () -> Firestore
    private let functions: Functions

    init(firestore: @escaping @MainActor () -> Firestore, functions: Functions) {
        self.firestore = firestore
        self.functions = functions
    }

    private func session(_ sessionId: String) -> DocumentReference {
        firestore().document(TMLPaths.shareSession(sessionId: sessionId))
    }

    // MARK: Callables

    public func createSession(_ request: TMLCreateSessionRequest) async throws(SharingError) -> TMLCreateSessionResponse {
        let payload: [String: Any]
        do {
            payload = try request.callablePayload()
        } catch {
            throw .failed
        }
        let json = try await call(TMLCallable.createSession, payload)
        do {
            return try TMLCreateSessionResponse.decode(json)
        } catch {
            throw .failed
        }
    }

    public func stopSession(sessionId: String) async throws(SharingError) -> TMLStopSessionResponse {
        let payload: [String: Any]
        do {
            payload = try TMLStopSessionRequest(sessionId: sessionId).callablePayload()
        } catch {
            throw .failed
        }
        let json = try await call(TMLCallable.stopSession, payload)
        do {
            return try TMLStopSessionResponse.decode(json)
        } catch {
            throw .failed
        }
    }

    public func discardSession(sessionId: String) async throws(SharingError) {
        let payload: [String: Any]
        do {
            payload = try TMLDiscardSessionRequest(sessionId: sessionId).callablePayload()
        } catch {
            throw .failed
        }
        do {
            _ = try await call(TMLCallable.discardSession, payload)
        } catch .sessionEnded {
            // not-found: already discarded (a retry after a lost answer). Done.
        }
    }

    // MARK: The session document

    public func sessionUpdates(sessionId: String) -> AsyncStream<SessionSnapshot> {
        let (stream, continuation) = AsyncStream.makeStream(of: SessionSnapshot.self, bufferingPolicy: .bufferingNewest(1))
        // Firestore calls listeners on the main queue. After an error it stops the listener for good,
        // so the stream ends too; ShareController listens again later.
        let registration = session(sessionId).addSnapshotListener { snapshot, error in
            guard let update = Self.update(from: snapshot, error: error) else { return }
            continuation.yield(update)
            if case .failed = update { continuation.finish() }
        }
        let listener = SessionListener(registration)
        continuation.onTermination = { _ in listener.remove() }
        return stream
    }

    /// What a snapshot means. A document missing from the cache says nothing yet.
    private static func update(from snapshot: DocumentSnapshot?, error: (any Error)?) -> SessionSnapshot? {
        if let error { return .failed(writeError(error)) }
        guard let snapshot else { return nil }
        guard snapshot.exists else { return snapshot.metadata.isFromCache ? nil : .missing }
        do {
            // Timestamps decode to Date; `last_ping_at` pending from this phone reads as its estimate.
            return .session(try snapshot.data(as: TMLShareSession.self, with: .estimate))
        } catch {
            return .failed(.failed)
        }
    }

    public func fetchSession(sessionId: String) async throws(SharingError) -> TMLShareSession? {
        let snapshot: DocumentSnapshot
        do {
            snapshot = try await session(sessionId).getDocument(source: .server)
        } catch {
            throw Self.writeError(error)
        }
        guard snapshot.exists else { return nil }
        do {
            return try snapshot.data(as: TMLShareSession.self, with: .estimate)
        } catch {
            throw .failed
        }
    }

    public func updateStopRule(sessionId: String, _ change: StopRuleChange) async throws(SharingError) {
        typealias Field = TMLShareSession.Field
        let fields: [AnyHashable: Any] = [
            Field.stopRule.rawValue: change.stopRule.rawValue,
            Field.stopMinutes.rawValue: change.stopMinutes.map { $0.rawValue as Any } ?? NSNull(),
            Field.stopAt.rawValue: change.stopAt.map { Timestamp(date: $0) as Any } ?? NSNull(),
        ]
        do {
            try await update(sessionId, fields)
        } catch .sessionEnded {
            // Refused: the change didn't apply, e.g. it waited offline past the rules' 60 s window
            // for stop_at. If the session is over, the listener says so.
            throw .rejected(field: Field.stopAt.rawValue)
        }
    }

    public func requestPrecision(sessionId: String, _ precision: TMLPrecision, place: PlaceUpdate?) async throws(SharingError) {
        do {
            try await update(sessionId, [TMLShareSession.Field.precisionNext.rawValue: precision.rawValue])
        } catch .sessionEnded {
            throw .rejected(field: TMLShareSession.Field.precisionNext.rawValue)
        }
    }

    public func writePing(sessionId: String, _ write: PingWrite) async throws(SharingError) {
        typealias Ping = TMLPing.Field
        typealias Session = TMLShareSession.Field
        let firestore = firestore()
        // One Timestamp for both, so last_fix_at is exactly the ping's recorded_at.
        let recordedAt = Timestamp(date: write.ping.recordedAt)
        let ping: [String: Any] = [
            Ping.lat.rawValue: write.ping.lat,
            Ping.lng.rawValue: write.ping.lng,
            Ping.accuracyM.rawValue: write.ping.accuracyM,
            Ping.recordedAt.rawValue: recordedAt,
        ]
        let check: [AnyHashable: Any] = [
            Session.lastPingAt.rawValue: FieldValue.serverTimestamp(),
            Session.lastFixAt.rawValue: recordedAt,
            Session.pingIntervalS.rawValue: write.pingInterval,
            Session.precision.rawValue: write.precision.rawValue,
            Session.precisionNext.rawValue: NSNull(),
        ]
        let batch = firestore.batch()
        batch.setData(ping, forDocument: firestore.collection(TMLPaths.pingCollection(sessionId: sessionId)).document())
        batch.updateData(check, forDocument: session(sessionId))
        do {
            try await batch.commit()
        } catch {
            throw Self.writeError(error)
        }
    }

    public func checkIn(sessionId: String, pingInterval: Double) async throws(SharingError) {
        typealias Field = TMLShareSession.Field
        try await update(sessionId, [
            Field.lastPingAt.rawValue: FieldValue.serverTimestamp(),
            Field.pingIntervalS.rawValue: pingInterval,
        ])
    }

    /// `fields` is `sending`: each caller builds a fresh dictionary that only the SDK's task then uses.
    private func update(_ sessionId: String, _ fields: sending [AnyHashable: Any]) async throws(SharingError) {
        do {
            try await session(sessionId).updateData(fields)
        } catch {
            throw Self.writeError(error)
        }
    }

    // MARK: Errors

    /// Calls a callable with a fresh Foundation payload (`sending`, as `update`); returns its result as JSON.
    private func call(_ name: String, _ payload: sending [String: Any]) async throws(SharingError) -> Data {
        do {
            let result = try await functions.httpsCallable(name).call(payload)
            return try JSONSerialization.data(withJSONObject: result.data, options: .fragmentsAllowed)
        } catch {
            let nsError = error as NSError
            if nsError.domain == FunctionsErrorDomain {
                throw .callable(code: nsError.code, details: nsError.userInfo[FunctionsErrorDetailsKey])
            }
            throw nsError.domain == NSURLErrorDomain ? .offline : .failed
        }
    }

    /// Firestore's errors on the sharer's reads and writes: the rules refuse a session that's over.
    private static func writeError(_ error: any Error) -> SharingError {
        let nsError = error as NSError
        if nsError.domain == FirestoreErrorDomain { return .write(code: nsError.code) }
        return nsError.domain == NSURLErrorDomain ? .offline : .failed
    }
}

/// A Firestore listener to remove when its stream ends. `ListenerRegistration.remove()` is safe on
/// any thread, which is what lets this box cross into the termination handler.
private final class SessionListener: @unchecked Sendable {
    private let registration: any ListenerRegistration

    init(_ registration: any ListenerRegistration) {
        self.registration = registration
    }

    func remove() {
        registration.remove()
    }
}
