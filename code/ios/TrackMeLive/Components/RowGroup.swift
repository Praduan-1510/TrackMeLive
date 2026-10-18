import SwiftUI
import TMLCore

/// Rows in one rounded `surface` group on `ground`, with hairlines between them inset to the text,
/// like an inset grouped list (prototype `.group .list`): the share screen's fields and the ended
/// screen's summary. Content, never glass.
struct RowGroup<Content: View>: View {
    var fill: Color = TMLColor.surface
    @ViewBuilder var content: Content
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content) { rows in
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 {
                        Rectangle()
                            .fill(TMLColor.separator)
                            .frame(height: 1 / displayScale)
                            .padding(.leading, TMLSpacing.space4)
                            .accessibilityHidden(true)
                    }
                    row
                }
            }
        }
        .background(fill, in: .rect(cornerRadius: TMLRadius.lg, style: .continuous))
    }
}

/// A row's title with its value on the trailing side and a chevron (it opens something) or an
/// up-down mark (a pull-down menu). At the accessibility sizes the value moves under the title, so
/// neither truncates. VoiceOver reads it as one element: the title, then the value.
struct ValueRowLabel: View {
    enum Accessory { case none, chevron, upDown }

    let title: String
    let value: String
    var accessory: Accessory = .none
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        HStack(spacing: TMLSpacing.space2) {
            let layout = stacked
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: TMLSpacing.space1))
                : AnyLayout(HStackLayout(spacing: TMLSpacing.space3))
            layout {
                Text(verbatim: title)
                    .foregroundStyle(TMLColor.ink)
                if !stacked { Spacer(minLength: 0) }
                Text(verbatim: value)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .monospacedDigit()
                    .multilineTextAlignment(stacked ? .leading : .trailing)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            switch accessory {
            case .none:
                EmptyView()
            case .chevron:
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(TMLColor.inkTertiary)
                    .accessibilityHidden(true)
            case .upDown:
                Image(systemName: "chevron.up.chevron.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(TMLColor.inkTertiary)
                    .accessibilityHidden(true)
            }
        }
        .font(.body)
        .padding(.horizontal, TMLSpacing.space4)
        .padding(.vertical, TMLSpacing.space3)
        .frame(minHeight: TMLSpacing.tapTarget + TMLSpacing.space1)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(Text(verbatim: value))
    }
}

/// A tappable row: it highlights while pressed without moving, like a list row.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(TMLColor.ink.opacity(configuration.isPressed ? 0.08 : 0))
            .contentShape(.rect)
    }
}

/// A summary line: the label on the left and its value on the right, the value under it at the
/// accessibility sizes (prototype `.summary .row`).
struct SummaryLine: View {
    let label: String
    let value: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: TMLSpacing.space1))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: TMLSpacing.space3))
        layout {
            Text(verbatim: label)
                .foregroundStyle(TMLColor.inkSecondary)
            if !stacked { Spacer(minLength: 0) }
            Text(verbatim: value)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(TMLColor.ink)
                .multilineTextAlignment(stacked ? .leading : .trailing)
        }
        .font(.callout)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TMLSpacing.space5)
        .padding(.vertical, TMLSpacing.space3)
        .accessibilityElement(children: .combine)
    }
}

/// The row components, for the previews.
private struct RowGroupGallery: View {
    var body: some View {
        ComponentPreview {
            RowGroup {
                ValueRowLabel(title: "Stops", value: "In 30 min", accessory: .chevron)
                ValueRowLabel(title: "Location", value: "Precise", accessory: .upDown)
            }
            RowGroup {
                SummaryLine(label: "Shared with", value: "Mom")
                SummaryLine(label: "Shared for", value: "14 min")
                SummaryLine(label: "Mom opened it", value: "9:40 pm")
            }
        }
    }
}

#Preview("Rows") { RowGroupGallery() }
#Preview("Rows, dark") { RowGroupGallery().preferredColorScheme(.dark) }
#Preview("Rows, AX5") { RowGroupGallery().dynamicTypeSize(.accessibility5) }
