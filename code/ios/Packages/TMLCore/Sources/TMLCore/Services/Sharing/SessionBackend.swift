import Foundation

/// Why a sharing call didn't work.
public enum SharingError: Error, Hashable, Sendable {
    /// Nobody is signed in, or not with a phone number (`permission-denied` from a callable).
    case notSignedIn
    /// The server says the sign-in is over (`unauthenticated`); the app signs out.
    case signInEnded
    /// Offline, or the server didn't answer in time. Trying again later may work.
    case offline
    /// Only one session runs at a time (`already-exists`, reason `active_session`).
    case alreadySharing(sessionId: String?)
    /// The session is over on the server: stopped, past `stop_at` or `expires_at`, or gone. A write
    /// the rules refuse (`permission-denied`) means this too.
    case sessionEnded
    /// The share sheet's discard came too late: someone has opened the link (`link_opened`).
    case linkOpened
    /// Location is off, so a share can't start.
    case locationOff
    /// The profile isn't finished (`no_profile`).
    case noProfile
    /// The server refused a value; `field` is the request key it named, when it named one.
    case rejected(field: String?)
    case failed

    /// One calm line for under the control that failed.
    public var message: String {
        switch self {
        case .notSignedIn:
            String(localized: "You\u{2019}re signed out. Sign in again, then try again.", bundle: .module)
        case .signInEnded:
            String(localized: "Your sign-in has ended. Sign in again.", bundle: .module)
        case .offline:
            String(localized: "We couldn\u{2019}t reach Track Me Live. Check your connection, then try again.", bundle: .module)
        case .alreadySharing:
            String(localized: "You\u{2019}re already sharing. Stop that share first.", bundle: .module)
        case .sessionEnded:
            String(localized: "This share has already ended.", bundle: .module)
        case .linkOpened:
            String(localized: "Your link has been opened, so sharing has started.", bundle: .module)
        case .locationOff:
            String(localized: "Turn on location for Track Me Live to share where you are.", bundle: .module)
        case .noProfile:
            String(localized: "Finish signing up before sharing.", bundle: .module)
        case .rejected, .failed:
            String(localized: "Something went wrong. Try again in a moment.", bundle: .module)
        }
    }

    /// Whether the same call may work if it's tried again later.
    public var isRetryable: Bool { self == .offline || self == .failed }
}

/// `shareSessions/{id}` as the listener sees it.
public enum SessionSnapshot: Hashable, Sendable {
    case session(TMLShareSession)
    /// The document doesn't exist on the server (discarded, deleted with the account, or purged).
    case missing
    /// The listener failed and has stopped; listen again to recover.
    case failed(SharingError)
}

/// A timer-sheet change, as the session fields the rules check (`validStopRule`).
public struct StopRuleChange: Hashable, Sendable {
    public var stopRule: TMLStopRule
    public var stopMinutes: TMLStopMinutes?
    public var stopAt: Date?

    public init(stopRule: TMLStopRule, stopMinutes: TMLStopMinutes? = nil, stopAt: Date? = nil) {
        self.stopRule = stopRule
        self.stopMinutes = stopMinutes
        self.stopAt = stopAt
    }
}

/// One ping and the session fields that go with it, written together in one batch
/// (x-decisions Q-PING-WRITE, Q-PLACE):
/// - `shareSessions/{id}/pings/{auto}`: the ping, already rounded when Approximate;
/// - `shareSessions/{id}`: `last_ping_at` = the server's time (the check-in), `last_fix_at` = the
///   ping's `recorded_at` (the very same timestamp), `ping_interval_s`, `precision` (applying any
///   `precision_next`), `precision_next` = null, and `place` when `place` isn't nil.
/// The rules judge the ping by the session as this same batch leaves it, so a precision change
/// and the first ping at the new precision land together. They also keep pings in order: each
/// `recorded_at` at least 2 s after the previous `last_fix_at`, so a retried batch that already
/// landed is refused like a session that's over (`PingUploader` tells the two apart).
public struct PingWrite: Hashable, Sendable {
    public var ping: TMLPing
    public var pingInterval: Double
    public var precision: TMLPrecision
    /// The session's new `place`, nil to leave it as it is. A looked-up place has `at` = the
    /// ping's `recorded_at`.
    public var place: PlaceUpdate?

    public init(ping: TMLPing, pingInterval: Double, precision: TMLPrecision, place: PlaceUpdate? = nil) {
        self.ping = ping
        self.pingInterval = pingInterval
        self.precision = precision
        self.place = place
    }
}

/// The session's wire: the session callables, the session listener and the sharer's own writes.
/// Only `ShareController` and `PingUploader` talk to it. Implementations: `FakeSessionBackend`
/// (TMLCore), `FirebaseSessionBackend` (code/ios/Firebase).
@MainActor
public protocol SessionBackend: AnyObject {
    /// The `createSession` callable.
    func createSession(_ request: TMLCreateSessionRequest) async throws(SharingError) -> TMLCreateSessionResponse
    /// Snapshots of `shareSessions/{id}` until the stream is dropped. Ends after `.failed`.
    func sessionUpdates(sessionId: String) -> AsyncStream<SessionSnapshot>
    /// The `stopSession` callable. Idempotent: an ended session returns how it ended.
    func stopSession(sessionId: String) async throws(SharingError) -> TMLStopSessionResponse
    /// The `discardSession` callable. Not-found counts as done.
    func discardSession(sessionId: String) async throws(SharingError)
    /// The timer sheet: `stop_rule`, `stop_minutes` and `stop_at` on the session.
    func updateStopRule(sessionId: String, _ change: StopRuleChange) async throws(SharingError)
    /// A precision change mid-session: `precision_next`, which the next ping applies, and with it
    /// `place` when `place` isn't nil. Turning Approximate on drops the name and street from the
    /// session's place in this same write, since the rules hold every update to that
    /// (x-decisions Q-PLACE).
    func requestPrecision(sessionId: String, _ precision: TMLPrecision, place: PlaceUpdate?) async throws(SharingError)
    /// A ping and its check-in, in one batch (`PingWrite`). Returns once the server has it.
    func writePing(sessionId: String, _ write: PingWrite) async throws(SharingError)
    /// `shareSessions/{id}` read from the server, not the cache; nil when it doesn't exist. Used to
    /// tell a refused retry of a ping that already landed from a session that's over.
    func fetchSession(sessionId: String) async throws(SharingError) -> TMLShareSession?
    /// A check-in without a ping (`last_ping_at` = server time, and `ping_interval_s`): at least
    /// every 30 s even without a GPS fix, so losing GPS alone never ends share back (FSD §6).
    func checkIn(sessionId: String, pingInterval: Double) async throws(SharingError)
}

extension SharingError {
    /// Cloud Functions' and Firestore's error codes (the gRPC codes).
    public enum Code {
        public static let deadlineExceeded = 4
        public static let invalidArgument = 3
        public static let notFound = 5
        public static let alreadyExists = 6
        public static let permissionDenied = 7
        public static let failedPrecondition = 9
        public static let aborted = 10
        public static let unavailable = 14
        public static let unauthenticated = 16
    }

    /// What a callable's error means. `details` is its `details` value: `{reason, session_id}` for
    /// already-exists, `{reason}` for failed-precondition, `{errors: [{field, message}]}` for
    /// invalid-argument.
    public static func callable(code: Int, details: Any?) -> SharingError {
        let details = details as? [String: Any]
        let reason = details?["reason"] as? String
        switch code {
        case Code.unauthenticated:
            return .signInEnded
        case Code.permissionDenied:
            return .notSignedIn
        case Code.unavailable, Code.deadlineExceeded:
            return .offline
        case Code.alreadyExists:
            return .alreadySharing(sessionId: details?["session_id"] as? String)
        case Code.notFound:
            return .sessionEnded
        case Code.failedPrecondition:
            switch reason {
            case "link_opened": return .linkOpened
            case "no_profile": return .noProfile
            case "session_ended": return .sessionEnded
            default: return .failed
            }
        case Code.invalidArgument:
            let errors = details?["errors"] as? [[String: Any]]
            return .rejected(field: errors?.first?["field"] as? String)
        default:
            return .failed
        }
    }

    /// What a Firestore write's error means. The rules refuse the sharer's writes once the session
    /// is over, so `permission-denied` there means the session has ended.
    public static func write(code: Int) -> SharingError {
        switch code {
        case Code.permissionDenied, Code.notFound: .sessionEnded
        case Code.unauthenticated: .signInEnded
        case Code.unavailable, Code.deadlineExceeded, Code.aborted: .offline
        default: .failed
        }
    }
}

extension TMLCreateSessionResponse {
    /// Decodes the callable's result data, JSON as `JSONSerialization` writes it.
    public static func decode(_ json: Data) throws -> TMLCreateSessionResponse {
        try SharingWire.decode(TMLCreateSessionResponse.self, from: json)
    }
}

extension TMLStopSessionResponse {
    public static func decode(_ json: Data) throws -> TMLStopSessionResponse {
        try SharingWire.decode(TMLStopSessionResponse.self, from: json)
    }
}

extension TMLStopSessionRequest {
    public func callablePayload() throws -> [String: Any] { try SharingWire.payload(self) }
}

extension TMLDiscardSessionRequest {
    public func callablePayload() throws -> [String: Any] { try SharingWire.payload(self) }
}
