import SwiftUI
import TMLCore
import UIKit

/// A mascot as drawn: the render for its color, with its accessory layer on top in the same box,
/// untinted. Picks the export for the size it's drawn at, and falls back from the color to the
/// Original, then to the flat SVG, then to a plain `lamplight` disc. Never a broken image.
///
/// Decorative: whoever shows it names the person or the mascot in text.
struct MascotImage: View {
    let look: MascotLook
    /// The box, in points. Renders and layers fill it, so they line up exactly.
    let size: CGFloat

    var body: some View {
        let art = MascotAssetLookup.resolve(look, size: MascotAssets.Size(drawnAt: size))
        ZStack {
            if let render = art.render.flatMap(MascotAssetLookup.image) {
                Image(uiImage: render)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                if let layer = art.accessoryLayer.flatMap(MascotAssetLookup.image) {
                    Image(uiImage: layer)
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                }
            } else {
                Circle().fill(TMLColor.lamplight)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Looks up asset-catalog images once per name. UIKit caches the images themselves; this
/// remembers which names are missing, so a fallback costs nothing after the first draw.
@MainActor
enum MascotAssetLookup {
    private static var missing: Set<String> = []

    static func image(_ name: String) -> UIImage? {
        guard !missing.contains(name) else { return nil }
        guard let image = UIImage(named: name) else {
            missing.insert(name)
            return nil
        }
        return image
    }

    static func resolve(_ look: MascotLook, size: MascotAssets.Size) -> MascotAssets.Resolved {
        MascotAssets.resolve(look, size: size) { image($0) != nil }
    }
}

/// A mascot on its soft `lamplight-halo`: Home's card, onboarding and the picker's stage.
/// Decorative unless it's given a spoken name, as on the picker's stage, where it is the subject.
struct MascotArt: View {
    let look: MascotLook
    var size: CGFloat
    /// The halo's diameter relative to the render.
    var haloScale: CGFloat = 1.2
    /// The gentle bob, only where the mascot is the subject (onboarding, the picker).
    var bobs = false
    /// What VoiceOver reads for it as an image ("Fox, Lagoon, with glasses"), or nil to hide it.
    var spokenName: String?

    init(look: MascotLook, size: CGFloat, haloScale: CGFloat = 1.2, bobs: Bool = false, spokenName: String? = nil) {
        self.look = look
        self.size = size
        self.haloScale = haloScale
        self.bobs = bobs
        self.spokenName = spokenName
    }

    /// The Original character with no accessory.
    init(mascot: Mascot, size: CGFloat, haloScale: CGFloat = 1.2, bobs: Bool = false) {
        self.init(look: MascotLook(mascot: mascot), size: size, haloScale: haloScale, bobs: bobs)
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(TMLColor.lamplightHalo)
                .frame(width: size * haloScale, height: size * haloScale)
            MascotImage(look: look, size: size)
                .modifier(Bob(enabled: bobs))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spokenName ?? ""))
        .accessibilityAddTraits(.isImage)
        .accessibilityHidden(spokenName == nil)
    }
}

/// The mascot's gentle bob on onboarding and in the picker, where the mascot is the subject.
/// With Reduce Motion on, nothing moves.
struct Bob: ViewModifier {
    var enabled = true
    var amplitude: CGFloat = 6
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if enabled && !reduceMotion {
            content.phaseAnimator([false, true]) { view, up in
                view.offset(y: up ? -amplitude : 0)
            } animation: { _ in
                .easeInOut(duration: 1.4)
            }
        } else {
            content
        }
    }
}

/// Every set's art in one color, with an accessory, for the previews.
private struct MascotImageGallery: View {
    var body: some View {
        ComponentPreview {
            MascotArt(look: MascotLook(mascot: .fox, color: .lagoon, accessory: .headphones), size: 152, haloScale: 1)
            HStack {
                ForEach([Mascot.ghost, .hero, .detective, .agent]) { mascot in
                    MascotImage(look: MascotLook(mascot: mascot, color: .dusk, accessory: .glasses), size: 62)
                }
            }
            HStack {
                ForEach(TMLMascotColor.allCases) { color in
                    MascotImage(look: MascotLook(mascot: .neko, color: color, accessory: .headlamp), size: 40)
                }
            }
        }
    }
}

#Preview("Mascot art") { MascotImageGallery() }
#Preview("Mascot art, dark") { MascotImageGallery().preferredColorScheme(.dark) }
#Preview("Mascot art, AX5") { MascotImageGallery().dynamicTypeSize(.accessibility5) }
