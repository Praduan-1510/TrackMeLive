import CoreGraphics

/// Where a look's pictures live in the app's asset catalog (filled by scripts/export-assets.sh),
/// and which one to draw when some are missing.
///
/// | Asset | Name | Exported at |
/// | --- | --- | --- |
/// | Render, Original | `mascot-<id>` | the 512px master (onboarding draws it up to 250pt) |
/// | Render, color | `mascot-<id>-<color>` | `stage`: 152pt at 2x and 3x (the picker, the largest place a color shows) |
/// | Accessory layer | `accessory-<id>-<accessory>` | `stage` |
/// | Avatar, any color | `avatar-<id>[-<color>]` | `avatar`: 40pt at 2x and 3x (markers, rows, the glass bar) |
/// | Avatar accessory layer | `avatar-accessory-<id>-<accessory>` | `avatar` |
/// | Flat | `mascot-<id>-flat` | SVG, for 20pt and below and as the last fallback |
///
/// Accessory layers are rendered with the mascot's camera, so they sit exactly on any color of
/// the render in the same square box. They don't fit the flat SVG, so a flat fallback goes without one.
public enum MascotAssets {
    /// The two export sizes.
    public enum Size: Sendable, CaseIterable {
        /// The picker's stage and tiles, Home's card, onboarding.
        case stage
        /// Markers (40pt in the disc), list avatars (32pt) and the glass bar.
        case avatar

        /// The point size each export is made for: the largest place it's drawn.
        public var points: CGFloat {
            switch self {
            case .stage: 152
            case .avatar: 40
            }
        }

        /// The size to use for art drawn `points` wide: the avatar set up to 40pt, the stage set above.
        public init(drawnAt points: CGFloat) {
            self = points <= Size.avatar.points ? .avatar : .stage
        }
    }

    /// iPhones on iOS 26 are 2x or 3x, so there's no 1x export.
    public static let scales: [Int] = [2, 3]

    public static func render(_ mascot: TMLMascotId, _ color: TMLMascotColor, size: Size) -> String {
        let suffix = color == .original ? "" : "-\(color.rawValue)"
        switch size {
        case .stage: return "mascot-\(mascot.rawValue)\(suffix)"
        case .avatar: return "avatar-\(mascot.rawValue)\(suffix)"
        }
    }

    public static func accessoryLayer(_ mascot: TMLMascotId, _ accessory: TMLMascotAccessory, size: Size) -> String {
        switch size {
        case .stage: "accessory-\(mascot.rawValue)-\(accessory.rawValue)"
        case .avatar: "avatar-accessory-\(mascot.rawValue)-\(accessory.rawValue)"
        }
    }

    public static func flat(_ mascot: TMLMascotId) -> String { mascot.flatAssetName }

    /// The renders to try for a look, best first: the right color before the right size, then the
    /// Original, then the flat SVG (design-system README, "Fallbacks").
    public static func renderCandidates(for look: MascotLook, size: Size) -> [String] {
        var names: [String] = []
        func add(_ name: String) { if !names.contains(name) { names.append(name) } }
        switch size {
        case .avatar:
            add(render(look.mascot, look.color, size: .avatar))
            add(render(look.mascot, look.color, size: .stage))
            add(render(look.mascot, .original, size: .avatar))
            add(render(look.mascot, .original, size: .stage))
        case .stage:
            add(render(look.mascot, look.color, size: .stage))
            add(render(look.mascot, .original, size: .stage))
        }
        add(flat(look.mascot))
        return names
    }

    /// What to draw for a look, given which assets exist. When nothing exists, the caller draws a
    /// plain `lamplight` disc: never an empty ring or a broken image.
    public static func resolve(_ look: MascotLook, size: Size, exists: (String) -> Bool) -> Resolved {
        guard let render = renderCandidates(for: look, size: size).first(where: exists) else {
            return Resolved(render: nil, isFlat: false, accessoryLayer: nil)
        }
        let isFlat = render == flat(look.mascot)
        var layer: String?
        if !isFlat, let accessory = look.accessory {
            let preferred = size == .avatar
                ? [accessoryLayer(look.mascot, accessory, size: .avatar), accessoryLayer(look.mascot, accessory, size: .stage)]
                : [accessoryLayer(look.mascot, accessory, size: .stage)]
            // A missing layer is simply not drawn, never shown broken.
            layer = preferred.first(where: exists)
        }
        return Resolved(render: render, isFlat: isFlat, accessoryLayer: layer)
    }

    public struct Resolved: Hashable, Sendable {
        /// The render or flat SVG to draw, or nil for the plain lamplight disc.
        public let render: String?
        /// True when only the flat SVG was found.
        public let isFlat: Bool
        /// The accessory layer to stack on the render, untinted.
        public let accessoryLayer: String?
    }

    /// Every asset name scripts/export-assets.sh must produce for the app, for its tests.
    public static func expectedAppAssets() -> [String] {
        var names: [String] = []
        for mascot in TMLMascotId.allCases {
            for color in TMLMascotColor.allCases {
                names.append(render(mascot, color, size: .stage))
                names.append(render(mascot, color, size: .avatar))
            }
            for accessory in mascot.accessories {
                names.append(accessoryLayer(mascot, accessory, size: .stage))
                names.append(accessoryLayer(mascot, accessory, size: .avatar))
            }
            names.append(flat(mascot))
        }
        return names
    }
}
