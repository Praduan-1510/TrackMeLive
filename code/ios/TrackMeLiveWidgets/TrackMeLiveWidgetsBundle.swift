import SwiftUI
import TMLCore
import WidgetKit

/// The widget extension: the share session's Live Activity and the Share location control.
@main
struct TrackMeLiveWidgetsBundle: WidgetBundle {
    init() {
        // Gabarito ships inside TMLCore's resource bundle, copied into this extension too.
        Gabarito.register()
    }

    var body: some Widget {
        ShareLiveActivity()
        ShareLocationControl()
    }
}
