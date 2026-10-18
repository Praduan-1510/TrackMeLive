import SwiftUI
import TMLCore

/// The pin that shows where a person is on the map (design-system/components/PersonMarker).
///
/// - Sharer: a 52pt `surface` disc, 3pt `lamplight` ring, a 1pt keyline outside it (`on-lamplight`
///   in light, `ground` in dark, 2pt with Increase Contrast), the mascot at 40pt, an 80pt halo.
/// - Viewer on the sharer's map: a 48pt `crossing` disc with the initial (or a person icon) in
///   `on-crossing`, a 3pt `surface` ring and a 72pt halo.
/// - Approximate: the 1 km circle at the map's scale in place of the halo.
/// - Last seen: a dashed `ink-tertiary` ring, no halo, no shadow, and "Last seen 9:41 pm".
///
/// The view's center is the person's position, so anchor it at its center. The name capsule and
/// the approximate circle draw outside its bounds without changing its size. Moving the marker
/// (a 600 ms glide, or a cross-fade with Reduce Motion) is the map's job; after each ping, change
/// `pingID` and the marker bobs 3pt once and its halo breathes once, then rests.
struct PersonMarker: View {
    let person: PersonAvatar.Person
    let state: MarkerState
    /// "You" on your own screen, the person's name on the other one. Last seen shows the time instead.
    let name: String
    /// The marker's one phrase (`PersonSpeech.marker`): "Alex, live, 1.2 kilometers away, updated 2 seconds ago".
    let spokenPhrase: String
    /// The approximate circle's diameter in points at the map's current scale (1 km across).
    var approximateDiameter: CGFloat?
    /// Changes with every ping.
    var pingID = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if reduceMotion || state.isLastSeen {
                MarkerBody(person: person, state: state, approximateDiameter: approximateDiameter, pose: PingPose())
            } else {
                KeyframeAnimator(initialValue: PingPose(), trigger: pingID) { pose in
                    MarkerBody(person: person, state: state, approximateDiameter: approximateDiameter, pose: pose)
                } keyframes: { _ in
                    KeyframeTrack(\.lift) {
                        CubicKeyframe(-3, duration: 1.2)
                        CubicKeyframe(0, duration: 1.2)
                    }
                    KeyframeTrack(\.halo) {
                        CubicKeyframe(1.12, duration: 1.2)
                        CubicKeyframe(1, duration: 1.2)
                    }
                }
            }
        }
        .overlay(alignment: .top) {
            MarkerCapsule(text: capsuleText, isQuiet: state.isLastSeen)
                .frame(width: MarkerMetrics.capsuleWidth, alignment: .top)
                .offset(y: frameSize / 2 + capsuleOffset)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spokenPhrase))
    }

    private var capsuleText: String {
        if case .lastSeen(let date) = state { TimeText.lastSeen(date) } else { name }
    }

    private var frameSize: CGFloat { MarkerMetrics.frame(for: person) }

    /// The capsule's top sits 8pt under the disc (34pt below the center for the sharer).
    private var capsuleOffset: CGFloat {
        switch person {
        case .sharer: MarkerMetrics.sharerDisc / 2 + TMLSpacing.space2
        case .viewer: MarkerMetrics.viewerDisc / 2 + TMLSpacing.space2
        }
    }
}

enum MarkerMetrics {
    static let sharerDisc: CGFloat = 52
    static let sharerHalo: CGFloat = 80
    static let sharerMascot: CGFloat = 40
    static let viewerDisc: CGFloat = 48
    static let viewerHalo: CGFloat = 72
    static let ring: CGFloat = 3
    /// Long names wrap inside this width rather than run across the map.
    static let capsuleWidth: CGFloat = 200

    static func frame(for person: PersonAvatar.Person) -> CGFloat {
        switch person {
        case .sharer: sharerHalo
        case .viewer: viewerHalo
        }
    }
}

/// The animated part of a ping: the disc's lift and the halo's scale.
private struct PingPose {
    var lift: CGFloat = 0
    var halo: CGFloat = 1
}

private struct MarkerBody: View {
    let person: PersonAvatar.Person
    let state: MarkerState
    let approximateDiameter: CGFloat?
    let pose: PingPose
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let frame = MarkerMetrics.frame(for: person)
        ZStack {
            halo.scaleEffect(pose.halo)
            disc.offset(y: pose.lift)
        }
        .frame(width: frame, height: frame)
        .background { approximateArea }
    }

    private var isLastSeen: Bool { state.isLastSeen }

    /// The 80pt (sharer) or 72pt (viewer) halo, only while live and precise.
    @ViewBuilder private var halo: some View {
        if !isLastSeen && approximateDiameter == nil {
            switch person {
            case .sharer:
                Circle().fill(TMLColor.lamplightHalo)
                    .frame(width: MarkerMetrics.sharerHalo, height: MarkerMetrics.sharerHalo)
            case .viewer:
                Circle().fill(TMLColor.crossingHalo)
                    .frame(width: MarkerMetrics.viewerHalo, height: MarkerMetrics.viewerHalo)
            }
        }
    }

    /// The 1 km circle around an approximate sharer, drawn to the map's scale. Grey once last seen.
    @ViewBuilder private var approximateArea: some View {
        if let approximateDiameter, case .sharer = person {
            Circle()
                .fill(isLastSeen ? TMLColor.inkTertiary.opacity(0.1) : TMLColor.lamplightHalo)
                .overlay {
                    Circle().strokeBorder(isLastSeen ? TMLColor.inkTertiary.opacity(0.4) : TMLColor.lamplight.opacity(0.45),
                                          lineWidth: 1.5)
                }
                .frame(width: approximateDiameter, height: approximateDiameter)
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder private var disc: some View {
        switch person {
        case .sharer(let look):
            ZStack {
                Circle().fill(TMLColor.surface)
                MascotImage(look: look, size: MarkerMetrics.sharerMascot)
                    .opacity(isLastSeen ? 0.55 : 1)
                ring(live: TMLColor.lamplight)
            }
            .frame(width: MarkerMetrics.sharerDisc, height: MarkerMetrics.sharerDisc)
            .background {
                // The keyline outside the ring holds the marker at 3:1 on light map colors.
                if !isLastSeen {
                    Circle()
                        .fill(colorScheme == .dark ? TMLColor.ground : TMLColor.onLamplight)
                        .padding(-(contrast == .increased ? 2 : 1))
                }
            }
            .modifier(MarkerShadow(enabled: !isLastSeen))
        case .viewer(let initial):
            ZStack {
                Circle().fill(isLastSeen ? TMLColor.surfaceRaised : TMLColor.crossing)
                // Gabarito Bold at 18pt for the initial.
                ViewerGlyph(initial: initial, size: 45, weight: 700)
                    .foregroundStyle(isLastSeen ? TMLColor.inkSecondary : TMLColor.onCrossing)
                ring(live: TMLColor.surface)
            }
            .frame(width: MarkerMetrics.viewerDisc, height: MarkerMetrics.viewerDisc)
            .modifier(MarkerShadow(enabled: !isLastSeen))
        }
    }

    @ViewBuilder private func ring(live color: Color) -> some View {
        if isLastSeen {
            Circle().strokeBorder(TMLColor.inkTertiary, style: StrokeStyle(lineWidth: MarkerMetrics.ring, dash: [4, 3]))
        } else {
            Circle().strokeBorder(color, lineWidth: MarkerMetrics.ring)
        }
    }
}

/// `shadow-marker`, the only shadow on the map. None on a last-seen marker.
private struct MarkerShadow: ViewModifier {
    let enabled: Bool
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        if enabled { content.tmlShadow(.marker, colorScheme: colorScheme) } else { content }
    }
}

/// The capsule under a marker: `caption-1` in `ink` on `surface` with a `separator` edge.
/// It grows with the text size; long names wrap.
private struct MarkerCapsule: View {
    let text: String
    let isQuiet: Bool

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .monospacedDigit()
            .multilineTextAlignment(.center)
            .foregroundStyle(isQuiet ? TMLColor.inkSecondary : TMLColor.ink)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, TMLSpacing.space2)
            .padding(.vertical, 2)
            .background(TMLColor.surface, in: .capsule)
            .overlay { Capsule().strokeBorder(TMLColor.separator, lineWidth: 1) }
    }
}

/// The distance between two people, on the dashed line's midpoint: `ink` fill, `ground` text in
/// the `metric` style. VoiceOver gets the long unit.
struct DistanceCapsule: View {
    let distance: DistanceText

    var body: some View {
        Text(distance.short)
            .displayFont(.metric)
            .monospacedDigit()
            .foregroundStyle(TMLColor.ground)
            .padding(.horizontal, TMLSpacing.space3)
            .padding(.vertical, 3)
            .background(TMLColor.ink, in: .capsule)
            .fixedSize()
            .accessibilityLabel(Text("\(distance.spoken) apart"))
    }
}

/// Every marker state on the map's land color, for the previews.
private struct PersonMarkerGallery: View {
    let now = Date()
    let look = MascotLook(mascot: .fox, color: .original, accessory: .headphones)

    var body: some View {
        ScrollView {
            Grid(horizontalSpacing: TMLSpacing.space8, verticalSpacing: 110) {
                GridRow {
                    PersonMarker(person: .sharer(look), state: .live, name: "Alex", spokenPhrase: "Alex, live")
                    PersonMarker(person: .viewer(initial: "M"), state: .live, name: "Mom", spokenPhrase: "Mom, sharing back")
                }
                GridRow {
                    PersonMarker(person: .sharer(look), state: .approximate, name: "Alex", spokenPhrase: "Alex, live",
                                 approximateDiameter: 150)
                    PersonMarker(person: .viewer(initial: nil), state: .live, name: "You", spokenPhrase: "You")
                }
                GridRow {
                    PersonMarker(person: .sharer(look), state: .lastSeen(now), name: "Alex", spokenPhrase: "Alex, last seen")
                    PersonMarker(person: .viewer(initial: "M"), state: .lastSeen(now), name: "Mom", spokenPhrase: "Mom, last seen")
                }
                GridRow {
                    DistanceCapsule(distance: DistanceText(meters: 1_234, units: .metric))
                        .gridCellColumns(2)
                }
            }
            .padding(.vertical, 80)
            .frame(maxWidth: .infinity)
        }
        .background(TMLColor.mapLand)
    }
}

#Preview("Markers") { PersonMarkerGallery() }
#Preview("Markers, dark") { PersonMarkerGallery().preferredColorScheme(.dark) }
#Preview("Markers, AX5") { PersonMarkerGallery().dynamicTypeSize(.accessibility5) }
