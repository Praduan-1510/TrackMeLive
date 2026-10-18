import CoreText
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// The Gabarito styles from the design system's type scale: titles, numbers and badges.
/// Body text, lists and controls stay in SF Pro (the system font) so the app still feels native.
///
/// Sizes are iOS's default (Large) Dynamic Type size. Each style grows with the reader's text size
/// through `UIFontMetrics` for its matching system text style, up to the accessibility sizes.
public struct DisplayStyle: Sendable, Hashable {
    public var name: String
    public var size: CGFloat
    public var lineHeight: CGFloat
    /// A point on Gabarito's weight axis (400 to 900).
    public var weight: Double
    public var tracking: CGFloat
    /// The system style whose Dynamic Type curve this style follows.
    public var textStyle: Font.TextStyle
    public var uppercase: Bool

    public init(name: String, size: CGFloat, lineHeight: CGFloat, weight: Double, tracking: CGFloat,
                relativeTo textStyle: Font.TextStyle, uppercase: Bool = false) {
        self.name = name
        self.size = size
        self.lineHeight = lineHeight
        self.weight = weight
        self.tracking = tracking
        self.textStyle = textStyle
        self.uppercase = uppercase
    }
}

public extension DisplayStyle {
    /// A display style from the generated token scale (`TMLType`, built from tokens.json).
    init(token: TMLTypeStyle) {
        self.init(name: token.name, size: token.size, lineHeight: token.lineHeight,
                  weight: Double(token.cssWeight), tracking: token.tracking,
                  relativeTo: token.relativeTo.textStyle, uppercase: token.name == "badge")
    }

    /// The one big title at the top of Home and the share screen.
    static let largeTitle = DisplayStyle(token: TMLType.largeTitle)
    /// Screen titles on pushed screens, and onboarding titles.
    static let title1 = DisplayStyle(token: TMLType.title1)
    /// Sheet titles over the map, and card titles.
    static let title2 = DisplayStyle(token: TMLType.title2)
    /// The big distance on the Live Activity and stat tiles.
    static let distance = DisplayStyle(token: TMLType.distance)
    /// Numbers inline: the distance capsule on the map, call timers.
    static let metric = DisplayStyle(token: TMLType.metric)
    /// LIVE, LIVE TOGETHER, NO SIGNAL, NO CONNECTION. The only uppercase text anywhere.
    static let badge = DisplayStyle(token: TMLType.badge)

    /// Every Gabarito style in the token scale.
    static let all: [DisplayStyle] = TMLType.all.filter { $0.family == .display }.map(DisplayStyle.init(token:))
}

/// A display style resolved for one text size: the font, and the line spacing that gives the
/// style's line height at that size.
public struct ResolvedDisplayFont {
    public let ctFont: CTFont
    public let pointSize: CGFloat
    public let lineHeight: CGFloat
    public let tracking: CGFloat

    public var font: Font { Font(ctFont) }

    /// Extra space between lines so lines sit `lineHeight` apart.
    public var lineSpacing: CGFloat {
        let natural = CTFontGetAscent(ctFont) + CTFontGetDescent(ctFont) + CTFontGetLeading(ctFont)
        return max(0, lineHeight - natural)
    }
}

public extension DisplayStyle {
    /// The weight to use when the reader has turned on Bold Text: one step (100) heavier.
    func weight(boldText: Bool) -> Double {
        boldText ? min(weight + 100, Gabarito.weightRange.upperBound) : weight
    }

    #if os(iOS)
    /// Resolves the style for a Dynamic Type size, scaled with `UIFontMetrics`.
    func resolve(sizeCategory: UIContentSizeCategory, boldText: Bool = false) -> ResolvedDisplayFont {
        let metrics = UIFontMetrics(forTextStyle: textStyle.uiTextStyle)
        let traits = UITraitCollection(preferredContentSizeCategory: sizeCategory)
        let pointSize = metrics.scaledValue(for: size, compatibleWith: traits)
        let scaledLine = metrics.scaledValue(for: lineHeight, compatibleWith: traits)
        return ResolvedDisplayFont(
            ctFont: Gabarito.ctFont(size: pointSize, weight: weight(boldText: boldText)),
            pointSize: pointSize,
            lineHeight: scaledLine,
            tracking: tracking
        )
    }

    /// Resolves the style for a SwiftUI Dynamic Type size. Large, the default, is the style's own
    /// size. Same signature on both platforms, so one call site compiles for iOS and for macOS.
    func resolve(dynamicTypeSize: DynamicTypeSize = .large, boldText: Bool = false) -> ResolvedDisplayFont {
        resolve(sizeCategory: UIContentSizeCategory(dynamicTypeSize), boldText: boldText)
    }
    #else
    /// macOS has no Dynamic Type; the style resolves at its default size. Same signature as on iOS.
    func resolve(dynamicTypeSize: DynamicTypeSize = .large, boldText: Bool = false) -> ResolvedDisplayFont {
        ResolvedDisplayFont(
            ctFont: Gabarito.ctFont(size: size, weight: weight(boldText: boldText)),
            pointSize: size,
            lineHeight: lineHeight,
            tracking: tracking
        )
    }
    #endif
}

#if os(iOS)
extension Font.TextStyle {
    var uiTextStyle: UIFont.TextStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
}
#endif

/// Sets text in a Gabarito display style that follows the environment's Dynamic Type size and
/// Bold Text setting.
public struct DisplayFontModifier: ViewModifier {
    public let style: DisplayStyle
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.legibilityWeight) private var legibilityWeight

    public init(style: DisplayStyle) { self.style = style }

    public func body(content: Content) -> some View {
        let resolved = style.resolve(dynamicTypeSize: dynamicTypeSize, boldText: legibilityWeight == .bold)
        content
            .font(resolved.font)
            .tracking(resolved.tracking)
            .lineSpacing(resolved.lineSpacing)
            .textCase(style.uppercase ? .uppercase : nil)
    }
}

public extension View {
    /// Sets text in a Gabarito display style (titles, numbers, badges), scaled with Dynamic Type.
    func displayFont(_ style: DisplayStyle) -> some View {
        modifier(DisplayFontModifier(style: style))
    }
}
