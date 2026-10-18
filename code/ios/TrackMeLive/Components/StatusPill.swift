import SwiftUI
import TMLCore

/// A capsule that names one person's or one session's state in words, with a small mark in its
/// color (design-system/components/StatusPill): Live, Last seen, Sharing ended, On a call.
/// The word is always there; the mark is a second signal, never the only one. Never `flare`.
struct StatusPill: View {
    private let text: Text
    let tone: StatusTone
    @ScaledMetric(relativeTo: .footnote) private var height: CGFloat = 30

    init(_ title: LocalizedStringKey, tone: StatusTone) {
        text = Text(title)
        self.tone = tone
    }

    @_disfavoredOverload
    init<S: StringProtocol>(_ title: S, tone: StatusTone) {
        text = Text(title)
        self.tone = tone
    }

    var body: some View {
        HStack(spacing: TMLSpacing.space2) {
            StatusMark(tone: tone)
            text
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(tone.textColor)
        .padding(.horizontal, TMLSpacing.space3)
        .padding(.vertical, TMLSpacing.space1)
        .frame(minHeight: height)
        .background(tone.washColor, in: .capsule)
        .accessibilityElement(children: .combine)
    }
}

extension StatusPill {
    /// Home's states, kept for the Home screen.
    enum Kind { case notSharing, live, call }

    init(kind: Kind) {
        switch kind {
        case .notSharing: self.init("Not sharing", tone: .quiet)
        case .live: self.init("Sharing live", tone: .sharer)
        case .call: self.init("On a call", tone: .call)
        }
    }
}

/// The small mark beside a status word: a dot in the person's color, a hollow dot for quiet
/// states, a small square for ended, a phone for a call. Decorative: the word carries the meaning.
struct StatusMark: View {
    let tone: StatusTone
    @ScaledMetric(relativeTo: .footnote) private var size: CGFloat = 8

    var body: some View {
        Group {
            switch tone {
            case .sharer: Circle().fill(TMLColor.lamplight)
            case .viewer: Circle().fill(TMLColor.crossing)
            case .quiet: Circle().strokeBorder(TMLColor.inkSecondary, lineWidth: max(1.5, size / 4))
            case .ended: RoundedRectangle(cornerRadius: 1).fill(TMLColor.ink)
            case .call:
                Image(systemName: "phone.fill")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(TMLColor.connected)
            }
        }
        // The phone glyph needs a little more room than a dot to read as a phone.
        .frame(width: tone == .call ? size * 1.5 : size, height: tone == .call ? size * 1.5 : size)
        .accessibilityHidden(true)
    }
}

/// An uppercase badge beside a title: LIVE, LIVE TOGETHER, NO SIGNAL, NO CONNECTION. The `badge`
/// style is the only uppercase text anywhere, and it does the uppercasing: pass the words in
/// sentence case ("Live together"), which is also what VoiceOver reads.
struct StatusBadge: View {
    enum Tone { case live, together, quiet }
    let title: String
    let tone: Tone
    @ScaledMetric(relativeTo: .caption2) private var height: CGFloat = 22
    @ScaledMetric(relativeTo: .caption2) private var dot: CGFloat = 6

    var body: some View {
        HStack(spacing: TMLSpacing.space1) {
            if tone == .live {
                Circle().fill(TMLColor.lamplight).frame(width: dot, height: dot).accessibilityHidden(true)
            }
            Text(title).displayFont(.badge)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, TMLSpacing.space2)
        .frame(minHeight: height)
        .background(background, in: .capsule)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
    }

    private var foreground: Color {
        switch tone {
        case .live: TMLColor.lamplightText
        case .together: TMLColor.crossingText
        case .quiet: TMLColor.inkSecondary
        }
    }

    private var background: Color {
        switch tone {
        case .live: TMLColor.lamplightWash
        case .together: TMLColor.crossingWash
        case .quiet: TMLColor.surfaceRaised
        }
    }
}

extension StatusTone {
    /// The word's color: the person's `-text` token, `ink-secondary` for quiet states.
    var textColor: Color {
        switch self {
        case .sharer: TMLColor.lamplightText
        case .viewer: TMLColor.crossingText
        case .quiet: TMLColor.inkSecondary
        case .ended: TMLColor.ink
        case .call: TMLColor.connected
        }
    }

    /// The pill's background.
    var washColor: Color {
        switch self {
        case .sharer: TMLColor.lamplightWash
        case .viewer: TMLColor.crossingWash
        case .quiet, .ended: TMLColor.surfaceRaised
        case .call: TMLColor.connectedWash
        }
    }
}

/// Every pill and badge, for the previews.
private struct StatusGallery: View {
    var body: some View {
        ComponentPreview {
            StatusPill("Live · updated 2 s ago", tone: .sharer)
            StatusPill("Sharing back", tone: .viewer)
            StatusPill("Last seen 9:41 pm", tone: .quiet)
            StatusPill("Sharing ended at 9:52 pm", tone: .ended)
            StatusPill("On a call · 04:12", tone: .call)
            StatusPill(kind: .notSharing)
            HStack {
                StatusBadge(title: "Live", tone: .live)
                StatusBadge(title: "Live together", tone: .together)
                StatusBadge(title: "No signal", tone: .quiet)
            }
        }
    }
}

#Preview("Status") { StatusGallery() }
#Preview("Status, dark") { StatusGallery().preferredColorScheme(.dark) }
#Preview("Status, AX5") { StatusGallery().dynamicTypeSize(.accessibility5) }
