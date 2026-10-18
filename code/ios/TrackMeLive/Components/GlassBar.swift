import SwiftUI
import TMLCore

/// The bar floating at the top of a map screen: who or what is live, one line under it, and one
/// control. System Liquid Glass in a `radius-lg` shape, so it follows the person's clear-to-tinted
/// setting, Reduce Transparency and Increase Contrast. It separates by its defined edge, never a
/// shadow, and nothing inside it is glass (no glass on glass).
///
///     GlassBar(title: "On a call", subtitle: "04:12") {
///         StatusMark(tone: .call)
///     } trailing: {
///         GlassBarButton("Home", systemImage: "house.fill") { … }
///     }
struct GlassBar<Leading: View, Trailing: View>: View {
    let title: String
    let subtitle: String
    /// A dot before the subtitle, in the person's color.
    var subtitleTone: StatusTone?
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    @ScaledMetric(relativeTo: .subheadline) private var minHeight: CGFloat = 60

    var body: some View {
        HStack(spacing: TMLSpacing.space3) {
            leading
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(TMLColor.ink)
                HStack(spacing: TMLSpacing.space2) {
                    if let subtitleTone { StatusMark(tone: subtitleTone) }
                    Text(subtitle)
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(TMLColor.inkSecondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            trailing
        }
        .padding(.leading, TMLSpacing.space3)
        .padding([.trailing, .vertical], TMLSpacing.space2)
        .frame(minHeight: minHeight)
        .glassEffect(.regular, in: .rect(cornerRadius: TMLRadius.lg, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// The control inside a glass bar: a 44pt opaque `surface-raised` circle (glass never stacks on
/// glass), with a spoken label. It keeps its size at every text size, so holding it shows the
/// Large Content Viewer.
struct GlassBarButton: View {
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
                .font(.body.weight(.semibold))
                .foregroundStyle(TMLColor.ink)
                .frame(width: TMLSpacing.tapTarget, height: TMLSpacing.tapTarget)
                .background(TMLColor.surfaceRaised, in: .circle)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityShowsLargeContentViewer()
    }
}

/// The bar while sharing and during a call, over the map, for the previews.
private struct GlassBarGallery: View {
    var body: some View {
        VStack(spacing: TMLSpacing.space4) {
            GlassBar(title: "Sharing live", subtitle: "Stops at 9:52 pm", subtitleTone: .sharer) {
                PersonAvatar(person: .sharer(MascotLook(mascot: .fox)), size: 36)
            } trailing: {
                GlassBarButton("Home", systemImage: "house.fill") {}
            }
            GlassBar(title: "On a call", subtitle: "04:12") {
                StatusMark(tone: .call)
            } trailing: {
                GlassBarButton("Home", systemImage: "house.fill") {}
            }
            Spacer()
        }
        .padding(TMLSpacing.space3)
        .background(TMLColor.mapLand)
    }
}

#Preview("Glass bar") { GlassBarGallery() }
#Preview("Glass bar, dark") { GlassBarGallery().preferredColorScheme(.dark) }
#Preview("Glass bar, AX5") { GlassBarGallery().dynamicTypeSize(.accessibility5) }
