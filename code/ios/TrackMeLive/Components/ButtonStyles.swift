import SwiftUI
import TMLCore

// The design system's buttons (design-system/components/Button): capsules, `headline` labels in
// sentence case that start with a verb, 50pt tall, never under 44pt, never with a shadow.
//
//   Button("Share live location") { … }.buttonStyle(.tmlProminent)   // the screen's one main action
//   Button("Change timer") { … }.buttonStyle(.tmlNeutral)            // inside a sheet
//   Button("Stop sharing", role: .destructive) { … }.buttonStyle(.tmlDestructive)
//   Button("Center the map") { … }.buttonStyle(.tmlGlass)            // floating over the map
//
// Labels wrap at large text sizes; they never truncate. Side-by-side buttons stack at the
// accessibility sizes (see `ButtonRow`).

enum ButtonMetrics {
    /// Buttons are 50pt tall (Button README); glass controls in a bar and plain buttons can be 44pt.
    static let height: CGFloat = 50
}

/// The prominent action: Liquid Glass prominent, tinted `lamplight`, with an `on-lamplight`
/// label (never white). One per screen.
struct TMLProminentButtonStyle: PrimitiveButtonStyle {
    var fullWidth = true

    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role, action: configuration.trigger) {
            configuration.label
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundStyle(TMLColor.onLamplight)
                .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: TMLSpacing.tapTarget)
                .contentShape(.capsule)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .tint(TMLColor.lamplight)
    }
}

/// Glass for controls that float over the map ("Center the map", "Close"). Never tinted, never
/// inside a glass sheet (use `.tmlNeutral` there).
struct TMLGlassButtonStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role, action: configuration.trigger) {
            configuration.label
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundStyle(TMLColor.ink)
                .frame(minHeight: TMLSpacing.tapTarget)
                .contentShape(.capsule)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
    }
}

/// The opaque buttons: Neutral (`surface-raised`, `ink`) and Destructive (`flare-wash`,
/// `flare-text`). Flare is only for stopping and deleting.
struct TMLFilledButtonStyle: ButtonStyle {
    enum Fill { case neutral, destructive }
    var fill: Fill
    var fullWidth = true

    func makeBody(configuration: Configuration) -> some View {
        FilledButtonBody(configuration: configuration, fill: fill, fullWidth: fullWidth)
    }
}

private struct FilledButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let fill: TMLFilledButtonStyle.Fill
    let fullWidth: Bool
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        configuration.label
            .font(.headline)
            .multilineTextAlignment(.center)
            .foregroundStyle(fill == .neutral ? TMLColor.ink : TMLColor.flareText)
            .padding(.horizontal, TMLSpacing.space5)
            .padding(.vertical, TMLSpacing.space3)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: ButtonMetrics.height)
            .background(fill == .neutral ? TMLColor.surfaceRaised : TMLColor.flareWash, in: .capsule)
            // Pressed: a state layer, so the bounds never move. A small scale unless Reduce Motion.
            .overlay { Capsule().fill(TMLColor.ink.opacity(configuration.isPressed ? 0.1 : 0)) }
            // Increase Contrast: a defined edge, since the fills sit close to the sheet's tiles.
            .overlay {
                if contrast == .increased {
                    Capsule().strokeBorder(fill == .neutral ? TMLColor.inkTertiary : TMLColor.flareText, lineWidth: 1)
                }
            }
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(.capsule)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

extension PrimitiveButtonStyle where Self == TMLProminentButtonStyle {
    static var tmlProminent: TMLProminentButtonStyle { TMLProminentButtonStyle() }
    static func tmlProminent(fullWidth: Bool) -> TMLProminentButtonStyle { TMLProminentButtonStyle(fullWidth: fullWidth) }
}

extension PrimitiveButtonStyle where Self == TMLGlassButtonStyle {
    static var tmlGlass: TMLGlassButtonStyle { TMLGlassButtonStyle() }
}

extension ButtonStyle where Self == TMLFilledButtonStyle {
    static var tmlNeutral: TMLFilledButtonStyle { TMLFilledButtonStyle(fill: .neutral) }
    static var tmlDestructive: TMLFilledButtonStyle { TMLFilledButtonStyle(fill: .destructive) }
    static func tmlNeutral(fullWidth: Bool) -> TMLFilledButtonStyle { TMLFilledButtonStyle(fill: .neutral, fullWidth: fullWidth) }
    static func tmlDestructive(fullWidth: Bool) -> TMLFilledButtonStyle { TMLFilledButtonStyle(fill: .destructive, fullWidth: fullWidth) }
}

/// The screen's one main action, full width, with an optional leading SF Symbol and a busy state
/// (a spinner and the button disabled while the work runs).
struct PrimaryButton: View {
    let title: LocalizedStringKey
    var systemImage: String?
    var isBusy = false
    let action: () -> Void

    init(_ title: LocalizedStringKey, systemImage: String? = nil, isBusy: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.isBusy = isBusy
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: TMLSpacing.space2) {
                if isBusy {
                    ProgressView().tint(TMLColor.onLamplight).accessibilityHidden(true)
                } else if let systemImage {
                    Image(systemName: systemImage).symbolRenderingMode(.hierarchical)
                }
                Text(title)
            }
        }
        .buttonStyle(.tmlProminent)
        .disabled(isBusy)
        .accessibilityValue(isBusy ? Text("In progress") : Text(verbatim: ""))
    }
}

/// A plain text button in `ink` (Skip, Not now). Crossing blue is never the app's tint.
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

/// An icon-only glass control over the map: a 44pt circle with a spoken label ("Close",
/// "Center the map"). It can't grow with the text size, so holding it shows the Large Content Viewer.
struct GlassIconButton: View {
    let title: LocalizedStringKey
    let systemImage: String
    let action: () -> Void

    init(_ title: LocalizedStringKey, systemImage: String, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .labelStyle(.iconOnly)
                .font(.headline)
                .foregroundStyle(TMLColor.ink)
                .frame(width: TMLSpacing.tapTarget, height: TMLSpacing.tapTarget)
                .contentShape(.circle)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityShowsLargeContentViewer()
    }
}

/// Two buttons side by side, stacked at the accessibility text sizes (or whenever their labels
/// wouldn't fit on one line), so labels never truncate.
struct ButtonRow<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: TMLSpacing.space2) { content }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: TMLSpacing.space2) { content.lineLimit(1) }
                VStack(spacing: TMLSpacing.space2) { content }
            }
        }
    }
}

/// Every button variant, for the previews.
private struct ButtonGallery: View {
    var body: some View {
        ComponentPreview {
            PrimaryButton("Share live location", systemImage: "location.fill") {}
            PrimaryButton("Save", isBusy: true) {}
            Button("Save") {}.buttonStyle(.tmlProminent).disabled(true)
            ButtonRow {
                Button("Change timer") {}.buttonStyle(.tmlNeutral)
                Button("Send link again") {}.buttonStyle(.tmlNeutral)
            }
            Button("Stop sharing", role: .destructive) {}.buttonStyle(.tmlDestructive)
            HStack {
                Button("Center the map", systemImage: "scope") {}.buttonStyle(.tmlGlass)
                GlassIconButton("Close", systemImage: "xmark") {}
            }
            .padding(TMLSpacing.space4)
            .background(TMLColor.mapLand, in: .rect(cornerRadius: TMLRadius.lg))
            PlainInkButton("Not now") {}
        }
    }
}

#Preview("Buttons") { ButtonGallery() }
#Preview("Buttons, dark") { ButtonGallery().preferredColorScheme(.dark) }
#Preview("Buttons, AX5") { ButtonGallery().dynamicTypeSize(.accessibility5) }
