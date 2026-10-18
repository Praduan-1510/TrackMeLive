import Foundation

/// Why a profile change didn't stick.
public enum ProfileError: Error, Hashable, Sendable {
    /// Nobody is signed in, or the profile hasn't loaded yet.
    case notSignedIn
    /// The server says the sign-in is over (`unauthenticated`): the account was deleted, disabled or
    /// its sign-in revoked. The app signs out, keeps only Appearance, and returns to sign-up.
    case signInEnded
    /// Offline, or the server didn't answer in time. Trying again later may work.
    case offline
    /// The server refused a value; `field` is the request key it named (`name`, `mascot_accessory`,
    /// `settings.precision`…) when it named one.
    case rejected(field: String?)
    /// Anything else.
    case failed

    /// One calm line for under the control that failed (design-system README, Errors).
    public var message: String {
        switch self {
        case .notSignedIn:
            String(localized: "You\u{2019}re signed out. Sign in again, then try again.", bundle: .module)
        case .signInEnded:
            String(localized: "Your sign-in has ended. Sign in again.", bundle: .module)
        case .offline:
            String(localized: "We couldn\u{2019}t save that. Check your connection, then try again.", bundle: .module)
        case .rejected, .failed:
            String(localized: "We couldn\u{2019}t save that. Try again in a moment.", bundle: .module)
        }
    }
}

/// What features change on the signed-in person's profile, `users/{uid}` (FSD §4 Sign up, Settings;
/// §6). The Mascot and Settings screens use it.
///
/// The app passes a `ProfileStore`, which applies each change on screen at once, saves it through the
/// `saveProfile` callable and rolls back if that fails. Tests use `FakeProfileService`.
@MainActor
public protocol ProfileService: AnyObject {
    /// The name people see on the map, 1–24 characters after tidying (`PersonName`).
    func save(name: String) async throws(ProfileError)
    /// The mascot, its color and accessory. `accessory` nil is none; it must be one the mascot takes.
    func save(mascot: TMLMascotId, color: TMLMascotColor, accessory: TMLMascotAccessory?) async throws(ProfileError)
    /// The whole settings object.
    func save(settings: TMLUserSettings) async throws(ProfileError)
    /// Settings › Delete account and all data. Signs out and starts the app over at onboarding.
    func deleteAccount() async throws(ProfileError)
}

/// `users/{uid}` as the listener sees it.
public enum ProfileSnapshot: Hashable, Sendable {
    /// The server says there is no profile yet (a new account, or one being created).
    case missing
    case loaded(TMLUser)
    case failed(ProfileError)
}

/// The profile's wire: the Firestore listener and the `saveProfile` callable. Only `ProfileStore`
/// talks to it. Implementations: `FakeProfileBackend` (TMLCore), `FirebaseProfileBackend` (code/ios/Firebase).
@MainActor
public protocol ProfileBackend: AnyObject {
    /// Snapshots of `users/{uid}` until the stream is dropped. A cached "missing" while offline is
    /// never sent: a returning user on a new phone must not look like a new account.
    func profileUpdates(uid: String) -> AsyncStream<ProfileSnapshot>
    /// The `saveProfile` callable: creates or replaces the editable profile, and returns it as stored.
    func saveProfile(_ request: TMLSaveProfileRequest) async throws(ProfileError) -> TMLUser
    /// The `deleteAccount` callable: the account and everything in it (FSD §8 Deletion). Idempotent.
    func deleteAccount() async throws(ProfileError)
    /// Forgets what this device cached of the account (Firestore's local cache), after a sign-out
    /// or a delete, so the next person on this phone never sees it.
    func clearLocalCache() async
}

// MARK: - The saveProfile wire

extension TMLSaveProfileRequest {
    /// A new account that hasn't picked a mascot: Fox, original color, no accessory, default settings.
    public static func newAccount(name: String) -> TMLSaveProfileRequest {
        TMLSaveProfileRequest(
            name: name,
            mascotId: TMLMascotCatalog.defaultMascot,
            mascotColor: TMLMascotCatalog.defaultColor,
            mascotAccessory: nil
        )
    }

    /// The whole editable profile as `user` has it. `settings` is sent only when it changes.
    public init(user: TMLUser, includeSettings: Bool) {
        self.init(
            name: user.name,
            mascotId: user.mascotId,
            mascotColor: user.mascotColor,
            mascotAccessory: user.mascotAccessory,
            settings: includeSettings ? user.settings : nil
        )
    }

    /// The callable's payload: snake_case keys, `mascot_accessory` always present (NSNull for none),
    /// `settings` only when set. Built with JSONSerialization, so it holds only Foundation types.
    public func callablePayload() throws -> [String: Any] {
        let data = try JSONEncoder().encode(self)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw EncodingError.invalidValue(self, .init(codingPath: [], debugDescription: "Not an object"))
        }
        return object
    }
}

extension TMLUser {
    /// The profile as `saveProfile` returns it (times in epoch ms).
    public init(_ response: TMLSaveProfileResponse) {
        self.init(
            name: response.name,
            mascotId: response.mascotId,
            mascotColor: response.mascotColor,
            mascotAccessory: response.mascotAccessory,
            lastViewerName: response.lastViewerName,
            settings: response.settings,
            activeSessionId: response.activeSessionId,
            createdAt: Date(timeIntervalSince1970: TimeInterval(response.createdAt) / 1000),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(response.updatedAt) / 1000)
        )
    }

    /// Decodes the callable's result data, JSON as `JSONSerialization` writes it.
    public static func decodeSaveProfileResponse(_ json: Data) throws -> TMLUser {
        TMLUser(try JSONDecoder().decode(TMLSaveProfileResponse.self, from: json))
    }

    /// The editable fields replaced by a request's (what `saveProfile` changes).
    func applying(_ request: TMLSaveProfileRequest) -> TMLUser {
        var user = self
        user.name = request.name
        user.mascotId = request.mascotId
        user.mascotColor = request.mascotColor
        user.mascotAccessory = request.mascotAccessory
        if let settings = request.settings { user.settings = settings }
        return user
    }
}

extension ProfileError {
    /// Cloud Functions' error codes (`FunctionsErrorCode` raw values, the gRPC codes).
    public enum CallableCode {
        public static let deadlineExceeded = 4
        public static let invalidArgument = 3
        public static let permissionDenied = 7
        public static let unavailable = 14
        public static let unauthenticated = 16
    }

    /// What a callable error means. `details` is the error's `details` value; for invalid-argument the
    /// functions send `{errors: [{field, message}]}`, and the first field is kept.
    public static func callable(code: Int, details: Any?) -> ProfileError {
        switch code {
        case CallableCode.unauthenticated:
            return .signInEnded
        case CallableCode.permissionDenied:
            return .notSignedIn
        case CallableCode.unavailable, CallableCode.deadlineExceeded:
            return .offline
        case CallableCode.invalidArgument:
            let errors = (details as? [String: Any])?["errors"] as? [[String: Any]]
            return .rejected(field: errors?.first?["field"] as? String)
        default:
            return .failed
        }
    }
}
