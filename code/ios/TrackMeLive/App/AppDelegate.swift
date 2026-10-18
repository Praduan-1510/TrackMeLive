import TMLCore
import UIKit

/// The few UIKit callbacks SwiftUI doesn't offer, passed to the backend. Firebase phone sign-in uses
/// a silent push to confirm the app (with reCAPTCHA as the fallback), so it needs the APNs token and
/// those pushes. Method swizzling is off (`FirebaseAppDelegateProxyEnabled` is NO in Info.plist), so
/// this forwarding is the only path, and it's explicit.
final class AppDelegate: NSObject, UIApplicationDelegate {
    private var hooks: (any AppLifecycleHooks)? { AppDependencies.shared.lifecycle }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        hooks?.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        // Firebase's own pushes need nothing more. The app's alerts arrive in a later sprint.
        _ = hooks?.handleRemoteNotification(userInfo)
        return .noData
    }
}
