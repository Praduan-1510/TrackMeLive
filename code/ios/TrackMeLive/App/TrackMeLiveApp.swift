import SwiftUI
import TMLCore

@main
struct TrackMeLiveApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Gabarito ships inside TMLCore; register it before the first title draws.
        Gabarito.register()
        NavigationBarTitles.useGabarito()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // trackmelive://share | live | stop, from the Live Activity.
                .onOpenURL { url in
                    if let route = TMLCore.Route(url: url) { model.open(route) }
                }
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
