import Foundation

/// What the app delegate passes on to the backend. Firebase phone sign-in needs the APNs token, its
/// silent "can you receive pushes?" check and the reCAPTCHA redirect URL. The fakes need none of it.
@MainActor
public protocol AppLifecycleHooks: AnyObject {
    func didRegisterForRemoteNotifications(deviceToken: Data)
    /// True when the notification was the backend's own and needs nothing more.
    func handleRemoteNotification(_ userInfo: [AnyHashable: Any]) -> Bool
    /// True when the URL was the backend's own (the reCAPTCHA redirect) and the app should ignore it.
    func handleOpenURL(_ url: URL) -> Bool
}
