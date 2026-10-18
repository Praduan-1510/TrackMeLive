import SwiftUI
import TMLCore

/// A number in a map sheet: an opaque `surface-raised` tile with `radius-md` corners (concentric
/// in the sheet), the value on top and its `footnote` label under it ("1.2 km" over "apart").
/// Until the viewer shares back, the distance tile reads "Waiting" over "for Mom to share".
/// Values never truncate or shrink: they wrap, and the row stacks at accessibility sizes.
struct StatTile: View {
    enum Style {
        /// `metric`: numbers inline, the default in a row of three.
        case metric
        /// `distance`: the one big number.
        case distance
    }

    let value: String
    let label: String
    /// The whole tile in long form for VoiceOver: "Sharing for 4 minutes", "1.2 kilometers apart".
    let spoken: String
    var style: Style = .metric
    /// Values that tick (timers, "updated 2 s ago") use SF Pro's tabular figures, so they don't jitter.
    var ticking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            valueText
                .foregroundStyle(TMLColor.ink)
            Text(label)
                .font(.footnote)
                .foregroundStyle(TMLColor.inkSecondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, TMLSpacing.space2)
        .padding(.horizontal, TMLSpacing.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TMLColor.surfaceRaised, in: .rect(cornerRadius: TMLRadius.md, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spoken))
    }

    @ViewBuilder private var valueText: some View {
        if ticking {
            Text(value)
                .font(style == .distance ? .title.bold() : .subheadline.bold())
                .monospacedDigit()
        } else {
            Text(value)
                .displayFont(style == .distance ? .distance : .metric)
        }
    }
}

/// Stat tiles side by side, as equal columns; one column at the accessibility sizes, or whenever
/// a value wouldn't fit on its line.
struct StatTileRow<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            column
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: TMLSpacing.space2) { content.lineLimit(1) }
                column
            }
        }
    }

    private var column: some View {
        VStack(spacing: TMLSpacing.space2) { content }
    }
}

/// The live sheet's three tiles, and the waiting state, for the previews.
private struct StatTileGallery: View {
    var body: some View {
        ComponentPreview {
            StatTileRow {
                StatTile(value: "1.2 km", label: "apart", spoken: "1.2 kilometers apart")
                StatTile(value: "4 min", label: "sharing", spoken: "Sharing for 4 minutes", ticking: true)
                StatTile(value: "9:52 pm", label: "stops", spoken: "Stops at 9:52 pm")
            }
            StatTileRow {
                StatTile(value: "Waiting", label: "for Mom to share", spoken: "Waiting for Mom to share")
                StatTile(value: "< 1 min", label: "sharing", spoken: "Sharing for less than a minute", ticking: true)
                StatTile(value: "When call ends", label: "stops", spoken: "Stops when the call ends")
            }
            StatTile(value: "1.2 km", label: "apart", spoken: "1.2 kilometers apart", style: .distance)
        }
    }
}

#Preview("Stat tiles") { StatTileGallery() }
#Preview("Stat tiles, dark") { StatTileGallery().preferredColorScheme(.dark) }
#Preview("Stat tiles, AX5") { StatTileGallery().dynamicTypeSize(.accessibility5) }
