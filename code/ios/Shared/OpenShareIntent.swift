import AppIntents
import TMLCore

/// What the Share location control (Control Center, the Lock Screen, the Action button) does:
/// open the app on the share screen for this call, or on the live map if a share is running.
/// It needs no permission.
///
/// Compiled into both the app and the widget extension (project.yml → `Shared`): the control
/// lives in the extension, and `openAppWhenRun` runs the intent in the app.
struct OpenShareIntent: AppIntent {
    static let title: LocalizedStringResource = "Share location"
    static let description = IntentDescription("Opens Track Me Live on the share screen.")
    static let openAppWhenRun = true

    /// Set by the app at launch, so the route opens at once when the intent runs in the app.
    @MainActor static var onRoute: ((TMLCore.Route) -> Void)?

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            // TODO(sharing): open `.live` instead while a session is running.
            if let onRoute = Self.onRoute {
                onRoute(.share)
            } else {
                // Not in the app's process: leave the route for the app to pick up when it opens.
                TMLCore.sharedDefaults.set(TMLCore.Route.share.rawValue, forKey: TMLCore.pendingRouteKey)
            }
        }
        return .result()
    }
}
