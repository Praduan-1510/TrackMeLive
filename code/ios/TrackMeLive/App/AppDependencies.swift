import Foundation
import TMLCore
#if canImport(TrackMeLiveFirebase)
import TrackMeLiveFirebase
#endif

/// The services the app runs on, chosen once at launch.
///
/// Sprint 1 runs on the fakes (`FakeAuthService`, `FakeProfileBackend`), which keep the sign-in and the
/// profile in UserDefaults so they survive a relaunch. Once Xcode builds the `TrackMeLiveFirebase`
/// target and the app links it (README, "Xcode day"), the launch argument `-backend emulator` runs the
/// same screens on the local Firebase emulators, in debug builds.
@MainActor
struct AppDependencies {
    enum Backend: String {
        case fake, emulator
    }

    let backend: Backend
    let auth: any AuthService
    let profileBackend: any ProfileBackend
    let settings: any SettingsStore
    let permissions: any PermissionsService
    /// Location access for sharing: the explainer, the system prompt and Precise Location.
    let locationAccess: any LocationAccess
    /// The share session: the callables, the listener, location in the background and the pings.
    let sharing: any SharingService
    /// This phone's `users/{uid}/devices/{deviceId}`, so the server's alerts reach it.
    let deviceRegistrar: DeviceRegistrar
    /// The backend's share of the app delegate: APNs and the reCAPTCHA redirect, for Firebase phone sign-in.
    let lifecycle: (any AppLifecycleHooks)?

    /// The app's own, made on first use (the app's init, before any scene).
    static let shared = AppDependencies.live(defaults: .standard)

    static func live(defaults: UserDefaults) -> AppDependencies {
        let settings = UserDefaultsSettingsStore(defaults: defaults)
        let permissions = LivePermissionsService(defaults: defaults)
        // The real permission prompts on every backend; it shares Settings' "asked" flag.
        let locationAccess = LiveLocationAccess(defaults: defaults)
        #if canImport(TrackMeLiveFirebase) && DEBUG
        // Debug builds only: the emulator setup turns off app verification for testing.
        if defaults.string(forKey: "backend") == Backend.emulator.rawValue {
            let firebase = FirebaseServices.emulator()
            let sharing = ShareController(backend: firebase.sessions,
                                          location: locationStream(defaults: defaults), access: locationAccess,
                                          battery: DeviceBattery())
            return AppDependencies(
                backend: .emulator, auth: firebase.auth, profileBackend: firebase.profiles,
                settings: settings, permissions: permissions, locationAccess: locationAccess, sharing: sharing,
                deviceRegistrar: DeviceRegistrar(backend: firebase.pushTokens, defaults: defaults), lifecycle: firebase
            )
        }
        #endif
        // Latency like a real network, so the busy states show.
        let auth = FakeAuthService(defaults: defaults, latency: .milliseconds(600))
        // On the fakes, the share walks a simulated route, so a viewer page has a marker to follow.
        let sharing = ShareController(backend: FakeSessionBackend(latency: .milliseconds(400)),
                                      location: SimulatedRouteStream(), access: locationAccess,
                                      battery: DeviceBattery())
        return AppDependencies(
            backend: .fake,
            auth: auth,
            profileBackend: FakeProfileBackend(auth: auth, defaults: defaults, latency: .milliseconds(400)),
            settings: settings,
            permissions: permissions,
            locationAccess: locationAccess,
            sharing: sharing,
            // No push token on the fakes, as on the Simulator.
            deviceRegistrar: DeviceRegistrar(backend: FakePushTokens(), defaults: defaults),
            lifecycle: nil
        )
    }

    /// The phone's location, or with `-location simulated` (debug builds) a walk along a route, so a
    /// viewer page in a desktop browser follows a moving marker without a device.
    static func locationStream(defaults: UserDefaults) -> any LocationStream {
        #if DEBUG
        if defaults.string(forKey: "location") == "simulated" { return SimulatedRouteStream() }
        #endif
        return LiveLocationStream()
    }

    /// In-memory fakes for previews: signed in as Alex with the given mascot (and a share in the
    /// given state), or signed out.
    static func preview(signedIn: Bool = true, mascot: TMLMascotId = .fox, sharing: ShareState = .idle) -> AppDependencies {
        let user = AuthUser(uid: "preview", phoneNumber: "+14155550142")
        let auth = FakeAuthService(signedIn: signedIn ? user : nil)
        let now = Date()
        let profile = TMLUser(name: "Alex", mascotId: mascot, mascotColor: .original, settings: .defaults,
                              createdAt: now, updatedAt: now)
        return AppDependencies(
            backend: .fake,
            auth: auth,
            profileBackend: FakeProfileBackend(auth: auth, profiles: signedIn ? [user.uid: profile] : [:]),
            settings: InMemorySettingsStore(hasOnboarded: signedIn, hasChosenMascot: signedIn),
            permissions: FixedPermissionsService(),
            locationAccess: FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, hasAsked: true)),
            sharing: FixedSharingService(state: sharing),
            deviceRegistrar: DeviceRegistrar(backend: FakePushTokens(), defaults: UserDefaults(suiteName: "tml.preview") ?? .standard),
            lifecycle: nil
        )
    }
}
