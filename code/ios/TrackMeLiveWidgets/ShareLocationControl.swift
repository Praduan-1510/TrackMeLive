import AppIntents
import SwiftUI
import WidgetKit

/// "Share location" for Control Center, the Lock Screen and the Action button (design system,
/// "Quick start"). Apps can't add it themselves; Home's Share faster during calls card shows how.
///
/// Neither iOS nor Android tells a closed app that a call has started, so this is the one-tap way
/// to share during a call. Tapping it runs `OpenShareIntent`, which opens the app.
struct ShareLocationControl: ControlWidget {
    static let kind = "live.trackme.app.control.share-location"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenShareIntent()) {
                Label("Share location", systemImage: "location.fill")
            }
        }
        .displayName("Share location")
        .description("Track Me Live")
    }
}
