#if os(iOS)
import SwiftUI
import UIKit

public extension Gabarito {
    /// Gabarito as a UIKit font at a point on the weight axis, unscaled.
    static func uiFont(size: CGFloat, weight: Double) -> UIFont {
        register()
        let attributes = Dictionary(uniqueKeysWithValues: descriptorAttributes(weight: weight).map {
            (UIFontDescriptor.AttributeName(rawValue: $0.key), $0.value)
        })
        return UIFont(descriptor: UIFontDescriptor(fontAttributes: attributes), size: size)
    }
}

public extension DisplayStyle {
    /// The style as a UIKit font for a text size (navigation bar titles, attributed strings).
    func uiFont(sizeCategory: UIContentSizeCategory, boldText: Bool = false) -> UIFont {
        let resolved = resolve(sizeCategory: sizeCategory, boldText: boldText)
        return Gabarito.uiFont(size: resolved.pointSize, weight: weight(boldText: boldText))
    }
}

public extension TMLColorToken {
    /// The token as a dynamic UIKit color that follows the trait collection's appearance.
    var uiColor: UIColor {
        let light = self.light, dark = self.dark
        return UIColor { traits in
            let c = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: c.red, green: c.green, blue: c.blue, alpha: c.alpha)
        }
    }
}
#endif
