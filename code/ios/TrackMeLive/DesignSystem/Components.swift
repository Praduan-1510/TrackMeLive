import SwiftUI
import TMLCore

// Small building blocks from the prototype's iPhone screens (prototype/css/app.css), built from
// standard SwiftUI controls and the generated tokens.

/// The screen's one main action: a prominent Liquid Glass button tinted lamplight, with an
/// on-lamplight label (never white on lamplight). Full width, capsule.
struct PrimaryButton: View {
    let title: LocalizedStringKey
    var systemImage: String?
    let action: () -> Void

    init(_ title: LocalizedStringKey, systemImage: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Group {
                if let systemImage {
                    Label(title, systemImage: systemImage)
                } else {
                    Text(title)
                }
            }
            .font(.headline)
            .foregroundStyle(TMLColor.onLamplight)
            .frame(maxWidth: .infinity, minHeight: TMLSpacing.tapTarget)
            .contentShape(.capsule)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .tint(TMLColor.lamplight)
    }
}

/// A plain text button in ink (Skip, Not now). Crossing blue is never the app's tint.
struct PlainInkButton: View {
    let title: LocalizedStringKey
    let action: () -> Void

    init(_ title: LocalizedStringKey, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(title, action: action)
            .buttonStyle(.borderless)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(TMLColor.ink)
            .frame(minWidth: TMLSpacing.tapTarget, minHeight: TMLSpacing.tapTarget)
            .contentShape(.rect)
    }
}

/// A card: a `surface` tile with `radius-lg` corners on the `ground` background. Content, never glass.
struct Card<Content: View>: View {
    var fill: Color = TMLColor.surface
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: TMLSpacing.space3) { content }
            .padding(TMLSpacing.space4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: .rect(cornerRadius: TMLRadius.lg, style: .continuous))
    }
}

/// A status pill: a word next to its color, never color alone (Not sharing, Sharing live, On a call).
struct StatusPill: View {
    enum Kind { case notSharing, live, call }
    let kind: Kind

    var body: some View {
        HStack(spacing: TMLSpacing.space2) {
            dot
            Text(label)
        }
        .font(.footnote.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(foreground)
        .padding(.horizontal, TMLSpacing.space3)
        .frame(minHeight: 28)
        .background(background, in: .capsule)
        .accessibilityElement(children: .combine)
    }

    private var label: LocalizedStringKey {
        switch kind {
        case .notSharing: "Not sharing"
        case .live: "Sharing live"
        case .call: "On a call"
        }
    }

    @ViewBuilder private var dot: some View {
        switch kind {
        case .notSharing:
            Circle().strokeBorder(TMLColor.inkSecondary, lineWidth: 2).frame(width: 8, height: 8)
        case .live:
            Circle().fill(TMLColor.lamplight).frame(width: 8, height: 8)
        case .call:
            Circle().fill(TMLColor.connected).frame(width: 8, height: 8)
        }
    }

    private var foreground: Color {
        switch kind {
        case .notSharing: TMLColor.inkSecondary
        case .live: TMLColor.lamplightText
        case .call: TMLColor.connected
        }
    }

    private var background: Color {
        switch kind {
        case .notSharing: TMLColor.surfaceRaised
        case .live: TMLColor.lamplightWash
        case .call: TMLColor.connectedWash
        }
    }
}

/// A mascot's render on its soft lamplight halo. Decorative: the caller names the mascot in text.
struct MascotArt: View {
    let mascot: Mascot
    var size: CGFloat
    /// The halo's diameter relative to the render.
    var haloScale: CGFloat = 1.2
    var bobs = false

    var body: some View {
        ZStack {
            Circle()
                .fill(TMLColor.lamplightHalo)
                .frame(width: size * haloScale, height: size * haloScale)
            Image(mascot.renderAssetName)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: size, height: size)
                .modifier(Bob(enabled: bobs))
        }
        .accessibilityHidden(true)
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

/// A section label above a group of controls ("Character").
struct SectionLabel: View {
    let title: LocalizedStringKey

    init(_ title: LocalizedStringKey) { self.title = title }

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(TMLColor.inkSecondary)
            .padding(.leading, TMLSpacing.space1)
            .accessibilityAddTraits(.isHeader)
    }
}

extension View {
    /// The standard screen margins: `space-5` on larger phones, `space-4` on standard ones.
    func screenMargins() -> some View {
        modifier(ScreenMargins())
    }
}

private struct ScreenMargins: ViewModifier {
    func body(content: Content) -> some View {
        content.safeAreaPadding(.horizontal, TMLSpacing.space5)
    }
}
