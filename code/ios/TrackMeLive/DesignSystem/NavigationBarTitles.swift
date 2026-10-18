import SwiftUI
import TMLCore
import UIKit

/// Large navigation titles (Your mascot, Settings) in Gabarito, scaled with `UIFontMetrics`.
/// Inline titles and everything else in the bar stay SF Pro.
enum NavigationBarTitles {
    @MainActor
    static func useGabarito() {
        apply()
        // The appearance proxy holds one font; refresh it when the reader changes their text size.
        NotificationCenter.default.addObserver(
            forName: UIContentSizeCategory.didChangeNotification, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { apply() }
        }
    }

    @MainActor
    private static func apply() {
        let category = UIApplication.shared.preferredContentSizeCategory
        let bold = UIAccessibility.isBoldTextEnabled
        UINavigationBar.appearance().largeTitleTextAttributes = [
            .font: DisplayStyle.largeTitle.uiFont(sizeCategory: category, boldText: bold),
            .kern: DisplayStyle.largeTitle.tracking,
            .foregroundColor: TMLColorToken.ink.uiColor,
        ]
    }
}
