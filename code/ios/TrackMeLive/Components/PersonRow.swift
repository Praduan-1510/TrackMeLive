import SwiftUI
import TMLCore

/// A person's avatar: the sharer's mascot in a `lamplight` ring, or the viewer's initial (a person
/// icon without a name) on `crossing`. Used in rows (40pt), the glass bar and the sheet.
/// Decorative: the row or bar it sits in says who it is.
struct PersonAvatar: View {
    enum Person: Hashable {
        case sharer(MascotLook)
        /// The initial of the name the sharer gave, or nil for a person icon.
        case viewer(initial: String?)
    }

    let person: Person
    var size: CGFloat = 40
    /// A viewer who isn't live (Waiting, Last seen): a `surface` disc with a dashed ring.
    var isQuiet = false

    var body: some View {
        ZStack {
            switch person {
            case .sharer(let look):
                Circle().fill(TMLColor.surfaceRaised)
                MascotImage(look: look, size: size * 0.8)
                Circle().strokeBorder(TMLColor.lamplight, lineWidth: 2)
            case .viewer(let initial):
                if isQuiet {
                    Circle().fill(TMLColor.surface)
                    Circle().strokeBorder(TMLColor.inkTertiary, style: StrokeStyle(lineWidth: 2, dash: [3, 3]))
                } else {
                    Circle().fill(TMLColor.crossing)
                }
                ViewerGlyph(initial: initial, size: size)
                    .foregroundStyle(isQuiet ? TMLColor.inkSecondary : TMLColor.onCrossing)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The viewer's initial in Gabarito, or a person icon. Fixed to the disc: the disc keeps its size
/// at every text size, so the glyph does too.
struct ViewerGlyph: View {
    let initial: String?
    let size: CGFloat
    /// Gabarito's weight: Heavy in avatars, Bold on the map marker.
    var weight: Double = 800

    var body: some View {
        if let initial {
            Text(initial).font(Font(Gabarito.ctFont(size: size * 0.4, weight: weight)))
        } else {
            Image(systemName: "person.fill").font(.system(size: size * 0.42, weight: .semibold))
        }
    }
}

/// One person in a session's list (design-system/components/PersonRow): avatar, name, a detail
/// line with the data's freshness, and a status word on the right. Read as one phrase:
/// "Mom, live, sharing back, updated 3 seconds ago". Rows are content, never glass.
struct PersonRow<Trailing: View>: View {
    let person: PersonAvatar.Person
    /// "You" for yourself; for the viewer, the name the sharer gave, or "Them".
    let name: String
    /// "Sharing back · updated 3 s ago", in tabular figures.
    let detail: String
    /// The detail in long form for VoiceOver ("Sharing back, updated 3 seconds ago"), if it differs.
    var spokenDetail: String?
    let status: String
    let tone: StatusTone
    var isQuiet = false
    /// Replaces the status word, such as an Ask to share button.
    @ViewBuilder var trailing: Trailing

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .headline) private var minHeight: CGFloat = 64

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                // The status moves under the text; names and details wrap.
                HStack(alignment: .top, spacing: TMLSpacing.space3) {
                    avatar
                    VStack(alignment: .leading, spacing: TMLSpacing.space1) {
                        text
                        statusOrTrailing
                    }
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: TMLSpacing.space3) {
                    avatar
                    text
                    Spacer(minLength: TMLSpacing.space2)
                    statusOrTrailing
                }
            }
        }
        .padding(.horizontal, TMLSpacing.space4)
        .padding(.vertical, TMLSpacing.space2)
        .frame(minHeight: minHeight)
        // A plain row is one element. With a trailing control, the text is one element and the
        // control stays its own.
        .modifier(SpokenAsOne(phrase: hasTrailing ? nil : phrase))
    }

    private var hasTrailing: Bool { Trailing.self != EmptyView.self }

    private var phrase: String {
        PersonSpeech.phrase(name: name, status: status, details: [spokenDetail ?? detail])
    }

    private var avatar: some View {
        PersonAvatar(person: person, size: 40, isQuiet: isQuiet)
    }

    private var text: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name)
                .font(.headline)
                .foregroundStyle(TMLColor.ink)
            Text(detail)
                .font(.subheadline)
                .monospacedDigit()
                .foregroundStyle(TMLColor.inkSecondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .modifier(SpokenAsOne(phrase: hasTrailing ? phrase : nil))
    }

    @ViewBuilder private var statusOrTrailing: some View {
        if !hasTrailing {
            HStack(spacing: TMLSpacing.space2) {
                StatusMark(tone: tone)
                Text(status)
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(tone.textColor)
        } else {
            trailing
        }
    }
}

/// Makes a view one accessibility element with the given phrase, or leaves it alone for nil.
private struct SpokenAsOne: ViewModifier {
    let phrase: String?

    func body(content: Content) -> some View {
        if let phrase {
            content.accessibilityElement(children: .ignore).accessibilityLabel(Text(phrase))
        } else {
            content
        }
    }
}

extension PersonRow where Trailing == EmptyView {
    init(person: PersonAvatar.Person, name: String, detail: String, spokenDetail: String? = nil,
         status: String, tone: StatusTone, isQuiet: Bool = false) {
        self.init(person: person, name: name, detail: detail, spokenDetail: spokenDetail,
                  status: status, tone: tone, isQuiet: isQuiet) { EmptyView() }
    }
}

/// Rows in one rounded group with hairlines inset to the text (68pt: the side padding, the
/// avatar and the gap). On `ground` the group is `surface` with `radius-lg`; inside a map sheet,
/// pass `.inSheet` for an opaque `surface-raised` tile with `radius-md`.
struct PersonGroup<Content: View>: View {
    enum Style { case onGround, inSheet }
    var style: Style = .onGround
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
                            .padding(.leading, TMLSpacing.space4 + 40 + TMLSpacing.space3)
                            .accessibilityHidden(true)
                    }
                    row
                }
            }
        }
        .background(style == .onGround ? TMLColor.surface : TMLColor.surfaceRaised,
                    in: .rect(cornerRadius: style == .onGround ? TMLRadius.lg : TMLRadius.md, style: .continuous))
    }
}

/// The two people in a session, in each state, for the previews.
private struct PersonRowGallery: View {
    var body: some View {
        ComponentPreview {
            PersonGroup {
                PersonRow(person: .sharer(MascotLook(mascot: .fox, color: .lagoon, accessory: .headphones)),
                          name: "You", detail: "Updated 2 s ago", spokenDetail: "updated 2 seconds ago",
                          status: "Live", tone: .sharer)
                PersonRow(person: .viewer(initial: "M"), name: "Mom",
                          detail: "Sharing back · updated 3 s ago", spokenDetail: "sharing back, updated 3 seconds ago",
                          status: "Live", tone: .viewer)
                PersonRow(person: .viewer(initial: nil), name: "Them", detail: "Link sent · not opened yet",
                          status: "Waiting", tone: .quiet, isQuiet: true)
            }
            PersonGroup(style: .inSheet) {
                PersonRow(person: .viewer(initial: "M"), name: "Mom", detail: "Opened your link at 9:40 pm",
                          status: "Watching", tone: .quiet) {
                    Button("Ask to share") {}.buttonStyle(.tmlNeutral(fullWidth: false))
                }
            }
        }
    }
}

#Preview("Person rows") { PersonRowGallery() }
#Preview("Person rows, dark") { PersonRowGallery().preferredColorScheme(.dark) }
#Preview("Person rows, AX5") { PersonRowGallery().dynamicTypeSize(.accessibility5) }
