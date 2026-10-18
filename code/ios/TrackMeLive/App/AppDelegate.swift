import TMLCore
import UIKit
import UserNotifications

/// The few UIKit callbacks SwiftUI doesn't offer, passed to the backend. Firebase phone sign-in uses
/// a silent push to confirm the app (with reCAPTCHA as the fallback), so it needs the APNs token and
/// those pushes. Method swizzling is off (`FirebaseAppDelegateProxyEnabled` is NO in Info.plist), so
/// this forwarding is the only path, and it's explicit.
final class AppDelegate: NSObject, UIApplicationDelegate {
    private var hooks: (any AppLifecycleHooks)? { AppDependencies.shared.lifecycle }

    /// Where alert taps go. Set as the first scene appears; a tap that launched the app waits here.
    weak var model: AppModel? {
        didSet {
            guard let model, let alert = pendingAlert else { return }
            pendingAlert = nil
            model.open(alert)
        }
    }
    private var pendingAlert: PushAlert?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Before launch finishes, so a tap that launched the app is delivered too.
        UNUserNotificationCenter.current().delegate = self
        return true
    }

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

/// The server's alerts (FSD §4 View notification): a tap opens the live screen while it's about the
/// share that's running, otherwise Home. Anything that isn't one of ours is left alone.
extension AppDelegate: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        guard let alert = PushAlert(userInfo: response.notification.request.content.userInfo) else { return }
        await MainActor.run { self.route(alert) }
    }

    /// In the foreground our alerts still show as a banner, so "Mom opened your link" is never missed.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        PushAlert(userInfo: notification.request.content.userInfo) != nil ? [.banner, .list, .sound] : []
    }

    private func route(_ alert: PushAlert) {
        if let model {
            model.open(alert)
        } else {
            pendingAlert = alert
        }
    }
}
