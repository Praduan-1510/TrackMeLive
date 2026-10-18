import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import FirebaseFunctions
import Foundation
import TMLCore

// The Firebase-backed services, in the TrackMeLiveFirebase target (project.yml). They compile only
// with the Firebase Apple SDK, which needs Xcode to resolve and build, so none of this is in
// scripts/typecheck.sh. The app reaches it through `#if canImport(TrackMeLiveFirebase)` in
// AppDependencies.swift. API shapes follow firebase-ios-sdk 12.19.2.

/// Firebase configured for the local emulators: the demo project `demo-trackmelive`, as the backend
/// and Android use it (code/backend/README.md, "Emulator ports").
@MainActor
public final class FirebaseServices: AppLifecycleHooks {
    public static let projectID = "demo-trackmelive"
    /// The iOS Simulator reaches the Mac's emulators on its loopback. A physical iPhone needs the
    /// emulators bound to 0.0.0.0 and the Mac's LAN address here.
    public static let emulatorHost = "127.0.0.1"
    public static let functionsRegion = "us-central1"

    public let auth: FirebaseAuthService
    public let profiles: FirebaseProfileBackend
    private let firebaseAuth: Auth

    private init(auth: Auth, makeFirestore: @escaping @MainActor () -> Firestore, functions: Functions) {
        firebaseAuth = auth
        self.auth = FirebaseAuthService(auth: auth)
        profiles = FirebaseProfileBackend(makeFirestore: makeFirestore, functions: functions)
    }

    /// Configures Firebase for the emulators: Auth 9099, Firestore 8080, Functions 5001. Call once, at
    /// launch, before anything else touches Firebase.
    public static func emulator(host: String = emulatorHost) -> FirebaseServices {
        if FirebaseApp.app() == nil {
            FirebaseApp.configure(options: demoOptions)
        }
        let auth = Auth.auth()
        auth.useEmulator(withHost: host, port: 9099)
        #if DEBUG
        // The Auth emulator sends no texts and needs neither APNs nor reCAPTCHA. Never in a release build.
        auth.settings?.isAppVerificationDisabledForTesting = true
        #endif
        let functions = Functions.functions(region: functionsRegion)
        functions.useEmulator(withHost: host, port: 5001)
        // A new instance after each cache clear needs the emulator again, before any other use.
        let makeFirestore: @MainActor () -> Firestore = {
            let firestore = Firestore.firestore()
            firestore.useEmulator(withHost: host, port: 8080)
            return firestore
        }
        return FirebaseServices(auth: auth, makeFirestore: makeFirestore, functions: functions)
    }

    /// The demo project has no GoogleService-Info.plist. These placeholders have the shapes the SDK
    /// checks (an app ID, and a 39-character key starting "AIza"); the emulators accept any values.
    /// The Info.plist's `app-1-000000000000-ios-0000000000000000` URL scheme matches the app ID.
    static var demoOptions: FirebaseOptions {
        let options = FirebaseOptions(googleAppID: "1:000000000000:ios:0000000000000000", gcmSenderID: "000000000000")
        options.projectID = projectID
        options.apiKey = "AIzaSy" + String(repeating: "0", count: 33)
        return options
    }

    // MARK: AppLifecycleHooks

    public func didRegisterForRemoteNotifications(deviceToken: Data) {
        // .unknown lets Auth tell the sandbox from production by the provisioning profile.
        firebaseAuth.setAPNSToken(deviceToken, type: .unknown)
    }

    public func handleRemoteNotification(_ userInfo: [AnyHashable: Any]) -> Bool {
        firebaseAuth.canHandleNotification(userInfo)
    }

    public func handleOpenURL(_ url: URL) -> Bool {
        firebaseAuth.canHandle(url)
    }
}
