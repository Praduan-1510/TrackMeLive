import SwiftUI
import TMLCore

@main
struct TrackMeLiveApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Gabarito ships inside TMLCore; register it before the first title draws.
        Gabarito.register()
        NavigationBarTitles.useGabarito()
        _model = State(initialValue: AppModel(dependencies: .shared))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // trackmelive://share | live | stop from the Live Activity, and Firebase's reCAPTCHA redirect.
                .onOpenURL { url in model.handleOpenURL(url) }
                .onChange(of: scenePhase, initial: true) { _, phase in
                    // The Share location control leaves its route in the App Group when it ran
                    // outside the app's process.
                    if phase == .active { model.consumePendingRoute() }
                }
                .onAppear {
                    OpenShareIntent.onRoute = { [model] route in model.open(route) }
                }
        }
    }
}
