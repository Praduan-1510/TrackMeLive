import MapKit
import SwiftUI
import TMLCore

/// Sharing live (FSD §4 Live map link, Stop rule, Location detail, Stop sharing, 1-hour warning;
/// prototype `viewLive`): the map with your marker where the viewer sees it, the glass bar with when
/// sharing stops and Home, and the map sheet with the status, the tiles, the people, the Location
/// control, Change timer, Send link again and Stop sharing. It replaces the share screen on Home's
/// stack, so there's no Back: Home goes back to Home and the share keeps running.
struct LiveScreen: View {
    let flow: ShareFlowModel
    @Bindable var model: LiveSessionModel
    let look: MascotLook

    @State private var showsSheet = false
    @State private var detent = PresentationDetent.mapSheetStandard
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        LiveMap(share: model.share, look: look)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: TMLSpacing.space2) {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let bar = model.presentation(at: context.date)?.bar
                        GlassBar(title: bar?.title ?? "Sharing live", subtitle: bar?.subtitle ?? "",
                                 subtitleTone: bar?.isCall == true ? nil : .sharer) {
                            PersonAvatar(person: .sharer(look), size: 36)
                        } trailing: {
                            GlassBarButton("Home", systemImage: "house.fill") {
                                showsSheet = false
                                flow.goHome()
                            }
                        }
                    }
                    if let toast = model.toast {
                        Toast(text: toast)
                            .transition(.opacity)
                    }
                }
                .padding(.horizontal, TMLSpacing.space3)
                .padding(.top, TMLSpacing.space1)
            }
            .politeAnnouncement(of: model.toast)
            .toolbarVisibility(.hidden, for: .navigationBar)
            .toolbarVisibility(.hidden, for: .tabBar)
            .navigationBarBackButtonHidden()
            .mapSheet(isPresented: $showsSheet, detent: $detent) {
                LiveSheet(model: model, look: look)
            }
            .task {
                // After the push, so the sheet never presents mid-transition.
                showsSheet = model.share != nil
            }
            .onChange(of: model.share == nil) { _, ended in
                if ended { showsSheet = false }
            }
    }
}

/// The map: your marker at the point the viewer sees (rounded, with the 1 km circle, while
/// Approximate), followed until you move the map yourself; then Center the map follows again.
private struct LiveMap: View {
    let share: LiveShare?
    let look: MascotLook

    @State private var camera = MapCameraPosition.userLocation(fallback: .automatic)
    @State private var spanMeters: Double = 800
    @State private var pingID = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            Map(position: $camera) {
                if let share, let point = share.lastPoint {
                    Annotation("", coordinate: point.coordinate, anchor: .center) {
                        PersonMarker(person: .sharer(look), state: markerState(share, point), name: "You",
                                     spokenPhrase: phrase(share, point),
                                     approximateDiameter: point.precision == .approximate
                                         ? approximateDiameter(height: geometry.size.height) : nil,
                                     pingID: pingID)
                    }
                    .annotationTitles(.hidden)
                }
            }
            .mapStyle(.standard(pointsOfInterest: .excludingAll))
            .mapControls { MapCompass() }
            // The sheet covers about half the screen at its standard height: frame the map above it.
            .safeAreaPadding(.bottom, geometry.size.height * 0.45)
            .onMapCameraChange(frequency: .onEnd) { context in
                spanMeters = context.region.span.latitudeDelta * 111_000
            }
            .overlay(alignment: .bottomTrailing) {
                if camera.positionedByUser, share?.lastPoint != nil {
                    Button("Center the map", systemImage: "location.fill") { follow(animated: true) }
                        .buttonStyle(.tmlGlass)
                        .padding(TMLSpacing.space4)
                        .padding(.bottom, geometry.size.height * 0.5)
                }
            }
        }
        .ignoresSafeArea()
        .onChange(of: share?.lastPoint) { _, point in
            guard point != nil else { return }
            pingID += 1
            if !camera.positionedByUser { follow(animated: true) }
        }
        .onAppear { follow(animated: false) }
    }

    private func follow(animated: Bool) {
        guard let point = share?.lastPoint else { return }
        // Wide enough for the 1 km circle while Approximate.
        let meters: Double = point.precision == .approximate ? 3_000 : 800
        spanMeters = meters
        let region = MapCameraPosition.region(MKCoordinateRegion(center: point.coordinate, latitudinalMeters: meters,
                                                                 longitudinalMeters: meters))
        if animated, !reduceMotion {
            withAnimation(.smooth(duration: 0.6)) { camera = region }
        } else {
            camera = region
        }
    }

    /// 1 km across at the map's scale, in points.
    private func approximateDiameter(height: CGFloat) -> CGFloat {
        guard spanMeters > 0, height > 0 else { return 120 }
        return max(48, 1_000 / (spanMeters / Double(height)))
    }

    private func markerState(_ share: LiveShare, _ point: SharedPoint) -> MarkerState {
        switch share.upload {
        case .noSignal, .offline: .lastSeen(share.clock.device(point.recordedAt))
        case .live, .waitingForFix: point.precision == .approximate ? .approximate : .live
        }
    }

    private func phrase(_ share: LiveShare, _ point: SharedPoint) -> String {
        PersonSpeech.marker(name: "You", role: .sharer, state: markerState(share, point), distance: nil,
                            updatedAt: point.recordedAt, now: share.clock.server(Date()))
    }
}

/// The map sheet's content, ticking each second for the tiles and the 1-hour warning.
private struct LiveSheet: View {
    @Bindable var model: LiveSessionModel
    let look: MascotLook

    var body: some View {
        VStack(spacing: 0) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                if let p = model.presentation(at: context.date) {
                    LiveSheetBody(model: model, look: look, p: p)
                }
            }
            // Right after the first link goes out: offer alerts, once (FSD §8).
            .sheet(item: $model.notificationsPrompt) { prompt in
                PermissionExplainer(systemImage: prompt.systemImage, title: prompt.title, message: prompt.message,
                                    confirmTitle: prompt.confirmTitle, cancelTitle: prompt.cancelTitle) {
                    Task { await model.turnOnAlerts() }
                } onNotNow: {
                    model.notificationsPrompt = nil
                }
            }
        }
        .sheet(isPresented: $model.isChoosingStop) {
            if let sheet = model.timerSheet(at: Date()) {
                TimerSheet(sheet: sheet) { choice in
                    Task { await model.choose(stop: choice) }
                } onClose: {
                    model.isChoosingStop = false
                }
            }
        }
        .alert("Stop sharing your location?", isPresented: $model.isConfirmingStop) {
            Button("Cancel", role: .cancel) {}
            Button("Stop", role: .destructive) { Task { await model.confirmStop() } }
        } message: {
            Text(verbatim: model.presentation(at: Date())?.stopMessage ?? "")
        }
        .locationAlert($model.prompt) { model.openSettings() }
        .shareSheet(item: $model.shareSheet) { model.shareSheetClosed($0) }
    }
}

private struct LiveSheetBody: View {
    @Bindable var model: LiveSessionModel
    let look: MascotLook
    let p: LivePresentation

    var body: some View {
        MapSheetContent(title: p.title, subtitle: p.subtitle) {
            StatusBadge(title: p.badge.title, tone: p.badge.tone == .live ? .live : .quiet)
                .accessibilityLabel(Text(verbatim: p.badge.spoken))
        } content: {
            if let warning = p.limitWarning {
                Label {
                    Text(verbatim: warning).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "clock").foregroundStyle(TMLColor.lamplightText)
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(TMLColor.ink)
            }
            if let error = model.error {
                ErrorLine(message: error.message)
            }
            StatTileRow {
                StatTile(value: p.distance.value, label: p.distance.label, spoken: p.distance.spoken)
                StatTile(value: p.duration.value, label: p.duration.label, spoken: p.duration.spoken, ticking: true)
                StatTile(value: p.stops.value, label: p.stops.label, spoken: p.stops.spoken)
            }
            PersonGroup(style: .inSheet) {
                PersonRow(person: .sharer(look), name: p.you.name, detail: p.you.detail, spokenDetail: p.you.spokenDetail,
                          status: p.you.status, tone: p.you.tone, isQuiet: p.you.isQuiet)
                PersonRow(person: .viewer(initial: p.viewerInitial), name: p.viewer.name, detail: p.viewer.detail,
                          spokenDetail: p.viewer.spokenDetail, status: p.viewer.status, tone: p.viewer.tone,
                          isQuiet: p.viewer.isQuiet)
            }
            if let note = p.shareBackNote {
                Text(verbatim: note)
                    .font(.footnote)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            PrecisionTile(model: model, control: p.precision)
        } actions: {
            ButtonRow {
                Button("Change timer") { model.isChoosingStop = true }
                    .buttonStyle(.tmlNeutral)
                Button { model.sendAgain() } label: {
                    Label("Send link again", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.tmlNeutral)
            }
        } pinned: {
            Button("Stop sharing", role: .destructive) { model.requestStop() }
                .buttonStyle(.tmlDestructive)
                .disabled(model.isStopping)
        }
        .politeAnnouncement(of: p.limitWarning)
    }
}

/// Precise or Approximate while sharing: the change applies from the next update. With Precise
/// Location off for the app, Precise asks for the system's one-time precise access first.
private struct PrecisionTile: View {
    let model: LiveSessionModel
    let control: LivePresentation.PrecisionControl

    var body: some View {
        VStack(alignment: .leading, spacing: TMLSpacing.space1) {
            ChoicePicker("Location", selection: selection, options: TMLPrecision.allCases) { $0.label }
            Text(verbatim: control.note)
                .font(.footnote)
                .foregroundStyle(TMLColor.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TMLSpacing.space4)
        .padding(.vertical, TMLSpacing.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TMLColor.surfaceRaised, in: .rect(cornerRadius: TMLRadius.md, style: .continuous))
    }

    private var selection: Binding<TMLPrecision> {
        Binding(get: { control.shown }, set: { option in Task { await model.choose(precision: option) } })
    }
}

extension SharedPoint {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

// MARK: - Previews

/// The live screen on fakes, in one state each, for the previews.
private struct LivePreviewScreen: View {
    let flow: ShareFlowModel

    init(_ share: LiveShare = .sample(), precise: Bool = true, confirmingStop: Bool = false, copied: Bool = false) {
        let sharing = FixedSharingService(state: .live(share))
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, precise: precise, hasAsked: true))
        flow = ShareFlowModel(sharing: sharing, access: access, permissions: FixedPermissionsService(notifications: .allowed),
                              profile: { nil })
        flow.live.isConfirmingStop = confirmingStop
        if copied { flow.live.linkCopied() }
    }

    var body: some View {
        NavigationStack {
            LiveScreen(flow: flow, model: flow.live, look: MascotLook(mascot: .fox, color: .lagoon, accessory: .headphones))
        }
    }
}

private extension LiveShare {
    static func preview(_ change: (inout LiveShare) -> Void) -> LiveShare {
        var share = LiveShare.sample(options: ShareOptions(viewerName: "Mom", stop: .minutes(.minutes30), shareBack: false,
                                                           precision: .precise))
        change(&share)
        return share
    }
}

#Preview("Live, not opened") { LivePreviewScreen() }
#Preview("Live, opened, dark") {
    LivePreviewScreen(.preview { $0.firstViewedAt = Date() }).preferredColorScheme(.dark)
}
#Preview("Live, AX5") { LivePreviewScreen(.preview { $0.firstViewedAt = Date() }).dynamicTypeSize(.accessibility5) }
#Preview("Live, approximate") {
    LivePreviewScreen(.sample(options: ShareOptions(stop: .minutes(.minutes15), shareBack: false, precision: .approximate)),
                      precise: false)
}
#Preview("Live, no GPS") { LivePreviewScreen(.preview { $0.upload = .noSignal(lastFixAt: Date()) }) }
#Preview("Live, offline") { LivePreviewScreen(.preview { $0.upload = .offline }) }
#Preview("Live, 1-hour warning") {
    LivePreviewScreen(.preview {
        $0.startedAt = Date().addingTimeInterval(-57 * 60)
        $0.expiresAt = Date().addingTimeInterval(3 * 60)
        $0.stopRule = .limit
        $0.stopAt = $0.expiresAt
    })
}
#Preview("Live, change pending") { LivePreviewScreen(.preview { $0.precisionNext = .approximate }) }
#Preview("Live, stop confirmation") { LivePreviewScreen(.preview { $0.firstViewedAt = Date() }, confirmingStop: true) }
#Preview("Live, link copied, dark") { LivePreviewScreen(copied: true).preferredColorScheme(.dark) }
