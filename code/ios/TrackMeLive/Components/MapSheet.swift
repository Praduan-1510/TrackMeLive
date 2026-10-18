import SwiftUI
import TMLCore

// The floating sheet over the map on every sharing screen (design-system/components/MapSheet).
//
// It's a system sheet at custom detents, so it gets iOS 27's Liquid Glass, the person's
// clear-to-tinted setting and the device-concentric inset corners by itself; it never sets its own
// background or shadow. Inside it, everything is opaque: `surface-raised` tiles and rows,
// Neutral and Destructive buttons. Glass never stacks on glass.
//
//     map
//         .mapSheet(isPresented: $showsSheet, detent: $detent) {
//             MapSheetContent(title: "Sharing live", subtitle: "Visible until your call ends.") {
//                 StatusBadge(title: "Live", tone: .live)
//             } content: {
//                 StatTileRow { … }
//                 PersonGroup(style: .inSheet) { … }
//             } actions: {
//                 ButtonRow { Button("Change timer") { … }.buttonStyle(.tmlNeutral) … }
//             } pinned: {
//                 Button("Stop sharing", role: .destructive) { … }.buttonStyle(.tmlDestructive)
//             }
//         }

/// About half the screen: the default, so the people on the map stay visible above the sheet.
struct MapSheetStandardDetent: CustomPresentationDetent {
    static func height(in context: Context) -> CGFloat? { context.maxDetentValue * 0.5 }
}

/// Just the title and the first line, to see more of the map.
struct MapSheetCompactDetent: CustomPresentationDetent {
    static func height(in context: Context) -> CGFloat? { context.maxDetentValue * 0.25 }
}

extension PresentationDetent {
    static let mapSheetCompact = PresentationDetent.custom(MapSheetCompactDetent.self)
    static let mapSheetStandard = PresentationDetent.custom(MapSheetStandardDetent.self)
}

extension View {
    /// Shows the session's sheet over this map at its custom detents. The map stays usable behind
    /// it up to the standard height, and the sheet can't be swiped away: it's how sharing stops.
    func mapSheet<SheetContent: View>(isPresented: Binding<Bool>, detent: Binding<PresentationDetent>,
                                      @ViewBuilder content: @escaping () -> SheetContent) -> some View {
        sheet(isPresented: isPresented) {
            content()
                .presentationDetents([.mapSheetCompact, .mapSheetStandard, .large], selection: detent)
                .presentationBackgroundInteraction(.enabled(upThrough: .mapSheetStandard))
                .presentationContentInteraction(.scrolls)
                .presentationDragIndicator(.visible)
                .interactiveDismissDisabled()
        }
    }
}

/// The sheet's layout: a `title-2` title with an optional badge, a `callout` line in
/// `ink-secondary`, the content, the actions, and one pinned action (Stop sharing) that stays at
/// the bottom when the content outgrows the sheet and scrolls.
struct MapSheetContent<Badge: View, Content: View, Actions: View, Pinned: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var badge: Badge
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions
    @ViewBuilder var pinned: Pinned

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TMLSpacing.space3) {
                header
                content
                actions
            }
            .padding(.horizontal, TMLSpacing.space5)
            .padding(.top, TMLSpacing.space3)
            .padding(.bottom, TMLSpacing.space3)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaBar(edge: .bottom) {
            pinned
                .padding(.horizontal, TMLSpacing.space5)
                .padding(.bottom, TMLSpacing.space5)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TMLSpacing.space1) {
            // The title wraps with its badge beside it, or under it when there's no room.
            FlowLayout(spacing: TMLSpacing.space3, lineSpacing: TMLSpacing.space1) {
                Text(title)
                    .displayFont(.title2)
                    .foregroundStyle(TMLColor.ink)
                    .accessibilityAddTraits(.isHeader)
                badge
            }
            if let subtitle {
                Text(subtitle)
                    .font(.callout)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

extension MapSheetContent where Badge == EmptyView {
    init(title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content,
         @ViewBuilder actions: () -> Actions, @ViewBuilder pinned: () -> Pinned) {
        self.init(title: title, subtitle: subtitle, badge: { EmptyView() }, content: content,
                  actions: actions, pinned: pinned)
    }
}

/// A map placeholder with the live sheet over it, for the previews.
private struct MapSheetGallery: View {
    @State private var showsSheet = true
    @State private var detent = PresentationDetent.mapSheetStandard

    var body: some View {
        TMLColor.mapLand
            .ignoresSafeArea()
            .overlay {
                PersonMarker(person: .sharer(MascotLook(mascot: .fox)), state: .live, name: "You", spokenPhrase: "You, live")
                    .offset(y: -160)
            }
            .mapSheet(isPresented: $showsSheet, detent: $detent) {
                MapSheetContent(title: "Sharing live", subtitle: "Visible until your call ends.") {
                    StatusBadge(title: "Live", tone: .live)
                } content: {
                    StatTileRow {
                        StatTile(value: "Waiting", label: "for Mom to share", spoken: "Waiting for Mom to share")
                        StatTile(value: "4 min", label: "sharing", spoken: "Sharing for 4 minutes", ticking: true)
                        StatTile(value: "When call ends", label: "stops", spoken: "Stops when the call ends")
                    }
                    PersonGroup(style: .inSheet) {
                        PersonRow(person: .sharer(MascotLook(mascot: .fox)), name: "You", detail: "Updated 2 s ago",
                                  status: "Live", tone: .sharer)
                        PersonRow(person: .viewer(initial: "M"), name: "Mom", detail: "Opened your link at 9:40 pm",
                                  status: "Watching", tone: .quiet)
                    }
                } actions: {
                    ButtonRow {
                        Button("Change timer") {}.buttonStyle(.tmlNeutral)
                        Button("Send link again") {}.buttonStyle(.tmlNeutral)
                    }
                } pinned: {
                    Button("Stop sharing", role: .destructive) {}.buttonStyle(.tmlDestructive)
                }
            }
    }
}

#Preview("Map sheet") { MapSheetGallery() }
#Preview("Map sheet, dark") { MapSheetGallery().preferredColorScheme(.dark) }
#Preview("Map sheet, AX5") { MapSheetGallery().dynamicTypeSize(.accessibility5) }
