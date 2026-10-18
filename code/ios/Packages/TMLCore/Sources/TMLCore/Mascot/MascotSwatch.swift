import SwiftUI

/// The picker's color swatches.
///
/// These are content colors, not UI tokens: each one is measured from the renders (the average of
/// the region that takes the color), so a swatch looks like the mascot it paints. Original shows
/// each character's own key color. The values match the prototype (prototype/js/app.js, `COLORS`
/// and `KEY`); TMLCore's tests check them against it.
public enum MascotSwatch {
    /// The swatch for a color on a character (Original differs per character).
    public static func rgba(_ color: TMLMascotColor, for mascot: TMLMascotId) -> TMLRGBA {
        switch color {
        case .original: originalKey(mascot)
        case .moss: TMLRGBA(rgba: 0xA3B13EFF)
        case .lagoon: TMLRGBA(rgba: 0x33B3A3FF)
        // ΔE 36.5 from crossing blue in light and 21.8 in dark, so it never reads as the viewer's color.
        case .dusk: TMLRGBA(rgba: 0x7A91C5FF)
        case .rose: TMLRGBA(rgba: 0xDD6A95FF)
        }
    }

    public static func color(_ color: TMLMascotColor, for mascot: TMLMascotId) -> Color {
        Color(tml: rgba(color, for: mascot))
    }

    private static func originalKey(_ mascot: TMLMascotId) -> TMLRGBA {
        switch mascot {
        case .fox: TMLRGBA(rgba: 0xE5AB5BFF)
        case .ghost: TMLRGBA(rgba: 0xBEC5C6FF)
        case .robot: TMLRGBA(rgba: 0x909EA4FF)
        case .astronaut: TMLRGBA(rgba: 0xD9DBDAFF)
        case .hero: TMLRGBA(rgba: 0xDC9654FF)
        case .star: TMLRGBA(rgba: 0xE1C2CDFF)
        case .ninja: TMLRGBA(rgba: 0x424860FF)
        case .neko: TMLRGBA(rgba: 0xE1DCD3FF)
        case .ace: TMLRGBA(rgba: 0x4D332BFF)
        case .detective: TMLRGBA(rgba: 0xD3BD92FF)
        case .cowboy: TMLRGBA(rgba: 0xE5C69BFF)
        case .agent: TMLRGBA(rgba: 0x454448FF)
        }
    }

    /// The selected swatch's check mark: whichever of the two fixed token colors reads better on
    /// the swatch (`on-lamplight` on light swatches, light `surface` on the dark ones: Ninja's,
    /// Ace's and Agent's Originals). Swatches don't change with the theme, so neither does this.
    public static func checkGlyph(on swatch: TMLRGBA) -> TMLRGBA {
        let dark = TMLColorToken.onLamplight.light
        let light = TMLColorToken.surface.light
        return Contrast.ratio(dark, swatch) >= Contrast.ratio(light, swatch) ? dark : light
    }
}

/// WCAG 2.x contrast between two opaque sRGB colors.
public enum Contrast {
    /// Relative luminance, 0 (black) to 1 (white).
    public static func luminance(_ c: TMLRGBA) -> Double {
        func channel(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(c.red) + 0.7152 * channel(c.green) + 0.0722 * channel(c.blue)
    }

    /// 1 to 21.
    public static func ratio(_ a: TMLRGBA, _ b: TMLRGBA) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }
}
