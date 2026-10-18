import SwiftUI
import TMLCore

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

/// A section label above a group of controls ("Character", "Color").
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

/// An error, said calmly next to what went wrong: `ink` text with an icon, never `flare`
/// (design-system README, "Errors, loading and empty states").
struct ErrorLine: View {
    let message: String

    var body: some View {
        Label {
            Text(message).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.circle")
        }
        .font(.footnote)
        .foregroundStyle(TMLColor.ink)
    }
}

/// Lays children out in rows, wrapping to a new row when the next one doesn't fit: accessory
/// chips and color swatches, which then never scroll sideways or truncate at large text sizes.
struct FlowLayout: Layout {
    var spacing: CGFloat = TMLSpacing.space2
    var lineSpacing: CGFloat = TMLSpacing.space2

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for (index, size) in zip(row.indices, row.sizes) {
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                                      proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var sizes: [CGSize] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, width maxWidth: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            // A child wider than the row gets the row's width and wraps its own text.
            var size = subviews[index].sizeThatFits(.unspecified)
            if size.width > maxWidth {
                size = subviews[index].sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
            }
            let needed = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if needed > maxWidth, !row.indices.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            row.sizes.append(size)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

/// Preview chrome for a component: on `ground`, in the screen margins, scrolling.
struct ComponentPreview<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TMLSpacing.space4) { content }
                .padding(TMLSpacing.space4)
        }
        .background(TMLColor.ground)
    }
}
