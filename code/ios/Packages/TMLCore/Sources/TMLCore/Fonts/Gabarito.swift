import CoreText
import Foundation

/// The brand typeface, bundled with TMLCore (SIL Open Font License; `Resources/OFL-Gabarito.txt`).
///
/// The file is Google Fonts' variable Gabarito (`ofl/gabarito/Gabarito[wght].ttf`), one font with a
/// weight axis from 400 to 900. Styles pick their weight on that axis, so there is one file to ship
/// and every weight in between is available.
///
/// The font is registered with the process the first time it's needed, from the package's resource
/// bundle, so the app and the widget extension both get it without an `UIAppFonts` entry.
public enum Gabarito {
    /// The family name CoreText reports for the bundled file.
    public static let familyName = "Gabarito"
    /// The PostScript name of the default (Regular) instance.
    public static let postScriptName = "Gabarito-Regular"
    /// The OpenType `wght` axis tag as CoreText's numeric identifier ('w','g','h','t').
    public static let weightAxis = 0x7767_6874
    /// The weights the variable font covers.
    public static let weightRange: ClosedRange<Double> = 400...900

    /// Where the bundled font file is.
    public static var fontURL: URL? {
        Bundle.module.url(forResource: "Gabarito-Variable", withExtension: "ttf")
    }

    /// Registers the bundled font once per process. Safe to call from anywhere, any number of
    /// times. Returns false only if the font file is missing or CoreText refused it.
    @discardableResult
    public static func register() -> Bool { registration }

    private static let registration: Bool = {
        guard let url = fontURL else { return false }
        var error: Unmanaged<CFError>?
        if CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) { return true }
        // Already registered (by another bundle, or UIAppFonts) is fine.
        if let error = error?.takeRetainedValue(),
           CFErrorGetCode(error) == CTFontManagerError.alreadyRegistered.rawValue {
            return true
        }
        return false
    }()

    /// Font attributes for Gabarito at a point on the weight axis, for CoreText, UIKit or AppKit
    /// descriptors. The weight is clamped to what the font covers.
    public static func descriptorAttributes(weight: Double) -> [String: Any] {
        let w = min(max(weight, weightRange.lowerBound), weightRange.upperBound)
        return [
            kCTFontNameAttribute as String: postScriptName,
            kCTFontVariationAttribute as String: [weightAxis: w],
        ]
    }

    /// Gabarito as a CoreText font, unscaled. Registers the font first.
    public static func ctFont(size: CGFloat, weight: Double) -> CTFont {
        register()
        let descriptor = CTFontDescriptorCreateWithAttributes(descriptorAttributes(weight: weight) as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }
}
