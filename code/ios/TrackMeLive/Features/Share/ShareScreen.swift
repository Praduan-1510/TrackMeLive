import SwiftUI
import TMLCore

/// Share where you are (FSD §4 Live map link, Who it's for, Stop rule, Location detail; prototype
/// `viewShare`): a preview of what they'll see, who it's for, when it stops, how precise, then
/// Share live location, which creates the session and opens the system share sheet with its link.
/// Pushed on Home's stack; Back returns to Home. Sprint 2 shares are manual, so no call or share
/// back rows show.
struct ShareScreen: View {
    @Bindable var model: ShareSetupModel
    let look: MascotLook

    @FocusState private var nameFocused: Bool
    @AccessibilityFocusState private var errorFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Share where you are")
                    .displayFont(.largeTitle)
                    .foregroundStyle(TMLColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: model.lede)
                    .font(.callout)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, TMLSpacing.space2)

                SharePreview(look: look, approximate: model.precision == .approximate, caption: model.previewCaption)
                    .padding(.top, TMLSpacing.space5)

                VStack(alignment: .leading, spacing: TMLSpacing.space2) {
                    RowGroup {
                        ViewerNameRow(model: model, focused: $nameFocused)
                        Button {
                            nameFocused = false
                            model.isChoosingStop = true
                        } label: {
                            ValueRowLabel(title: "Stops", value: model.stopLabel, accessory: .chevron)
                        }
                        .buttonStyle(RowButtonStyle())
                        .accessibilityHint("Opens when sharing stops")
                        PrecisionMenu(model: model)
                    }
                    Text("Only you see the name. They see your name and mascot.")
                        .font(.footnote)
                        .foregroundStyle(TMLColor.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, TMLSpacing.space4)
                }
                .padding(.top, TMLSpacing.space5)

                VStack(spacing: TMLSpacing.space2) {
                    if let error = model.error {
                        ErrorLine(message: error.message)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityFocused($errorFocused)
                    }
                    PrimaryButton("Share live location", systemImage: "location.fill", isBusy: model.isStarting) {
                        nameFocused = false
                        Task { await model.share() }
                    }
                    Text("Next, choose who gets the link.")
                        .font(.caption)
                        .foregroundStyle(TMLColor.inkSecondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, TMLSpacing.space6)
            }
            .padding(.top, TMLSpacing.space2)
            .padding(.bottom, TMLSpacing.space8)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenMargins()
        .background(TMLColor.ground)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(.hidden, for: .tabBar)
        .sheet(isPresented: $model.isChoosingStop) {
            TimerSheet(sheet: model.timerSheet) { model.choose(stop: $0) } onClose: { model.isChoosingStop = false }
        }
        .locationAlert($model.prompt) { model.openSettings() }
        .shareSheet(item: $model.shareSheet) { outcome in
            Task { await model.shareSheetClosed(outcome) }
        }
        .onChange(of: model.error) { _, error in
            // Say what went wrong and put VoiceOver on it.
            guard error != nil else { return }
            errorFocused = true
        }
    }
}

/// What the viewer will see: the map with you on it (decorative; the words around it say the same).
private struct SharePreview: View {
    let look: MascotLook
    let approximate: Bool
    let caption: String

    var body: some View {
        ZStack(alignment: .bottom) {
            PreviewMap()
            PersonMarker(person: .sharer(look), state: approximate ? .approximate : .live, name: "You",
                         spokenPhrase: "", approximateDiameter: approximate ? 150 : nil)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .offset(y: -24)
            HStack(spacing: TMLSpacing.space3) {
                StatusBadge(title: "Live", tone: .live)
                Text(verbatim: caption)
                    .font(.footnote)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TMLSpacing.space3)
            .padding(.vertical, TMLSpacing.space2)
            .glassEffect(.regular, in: .rect(cornerRadius: TMLRadius.md, style: .continuous))
            .padding(TMLSpacing.space3)
        }
        .frame(height: 210)
        .clipShape(.rect(cornerRadius: TMLRadius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TMLRadius.lg, style: .continuous)
                .strokeBorder(TMLColor.separator, lineWidth: 1)
        }
        .accessibilityHidden(true)
    }
}

/// A few streets on the map's land color: the preview's backdrop, in the map tokens, never a live map.
private struct PreviewMap: View {
    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(TMLColor.mapLand))
            let park = Path(roundedRect: CGRect(x: size.width * 0.66, y: size.height * 0.08,
                                                width: size.width * 0.26, height: size.height * 0.34), cornerRadius: 10)
            context.fill(park, with: .color(TMLColor.mapPark))
            var water = Path()
            water.move(to: CGPoint(x: 0, y: size.height * 0.78))
            water.addCurve(to: CGPoint(x: size.width * 0.42, y: size.height),
                           control1: CGPoint(x: size.width * 0.16, y: size.height * 0.76),
                           control2: CGPoint(x: size.width * 0.3, y: size.height * 0.9))
            water.addLine(to: CGPoint(x: 0, y: size.height))
            water.closeSubpath()
            context.fill(water, with: .color(TMLColor.mapWater))
            var roads = Path()
            roads.move(to: CGPoint(x: 0, y: size.height * 0.3))
            roads.addLine(to: CGPoint(x: size.width, y: size.height * 0.52))
            roads.move(to: CGPoint(x: size.width * 0.32, y: 0))
            roads.addLine(to: CGPoint(x: size.width * 0.58, y: size.height))
            context.stroke(roads, with: .color(TMLColor.mapRoad), lineWidth: 10)
            var major = Path()
            major.move(to: CGPoint(x: size.width * 0.82, y: 0))
            major.addLine(to: CGPoint(x: size.width * 0.7, y: size.height))
            context.stroke(major, with: .color(TMLColor.mapRoadMajor), lineWidth: 14)
        }
    }
}

/// Who it's for: the label, then the name field and its clear button. The label sits above the
/// field at the accessibility sizes.
private struct ViewerNameRow: View {
    @Bindable var model: ShareSetupModel
    var focused: FocusState<Bool>.Binding
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: TMLSpacing.space1))
            : AnyLayout(HStackLayout(spacing: TMLSpacing.space3))
        layout {
            Text("Who it\u{2019}s for (optional)")
                .foregroundStyle(TMLColor.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true) // the field carries the same label
            HStack(spacing: TMLSpacing.space1) {
                TextField("Who it\u{2019}s for (optional)", text: $model.viewerName, prompt: Text("Name"))
                    .focused(focused)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
                    .foregroundStyle(focused.wrappedValue ? TMLColor.ink : TMLColor.inkSecondary)
                    .frame(minHeight: TMLSpacing.tapTarget)
                    .accessibilityHint("Only you see it.")
                if model.canClearName {
                    Button {
                        model.clearViewerName()
                        focused.wrappedValue = true
                    } label: {
                        Label("Clear the name", systemImage: "xmark.circle.fill")
                            .labelStyle(.iconOnly)
                            .foregroundStyle(TMLColor.inkTertiary)
                            .frame(width: TMLSpacing.tapTarget, height: TMLSpacing.tapTarget)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.leading, TMLSpacing.space4)
        .padding(.trailing, model.canClearName ? 0 : TMLSpacing.space4)
        .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? TMLSpacing.space2 : 0)
        .frame(minHeight: TMLSpacing.tapTarget + TMLSpacing.space1)
    }
}

/// Location: Precise or Approximate in a pull-down menu, each with its line. With Precise Location
/// off for the app, Precise asks for the system's one-time precise access.
private struct PrecisionMenu: View {
    @Bindable var model: ShareSetupModel

    var body: some View {
        Menu {
            // Toggles show as menu items with a check on the chosen one, and VoiceOver says which.
            ForEach(TMLPrecision.allCases) { option in
                Toggle(isOn: chosen(option)) {
                    Text(option.label)
                    Text(verbatim: model.precisionDetail(option))
                }
            }
        } label: {
            ValueRowLabel(title: "Location", value: model.precision.label, accessory: .upDown)
        }
        .menuStyle(.button)
        .buttonStyle(RowButtonStyle())
        .accessibilityLabel("Location")
        .accessibilityValue(Text("\(model.precision.label), \(model.precisionDetail(model.precision))"))
    }

    private func chosen(_ option: TMLPrecision) -> Binding<Bool> {
        Binding(get: { model.precision == option },
                set: { if $0 { Task { await model.choose(precision: option) } } })
    }
}

// MARK: - Previews

/// The share screen on in-memory fakes, for the previews.
private struct SharePreviewScreen: View {
    let model: ShareSetupModel

    init(lastViewerName: String? = "Mom", precise: Bool = true, error: SharingError? = nil, prompt: LocationPrompt? = nil) {
        let sharing = FixedSharingService()
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, precise: precise, hasAsked: true))
        // A local, so the task below captures the model rather than `self` mid-initialization.
        let model = ShareSetupModel(settings: .defaults, lastViewerName: lastViewerName, sharerName: "Alex",
                                    gatePrecision: precise ? .precise : .approximate, sharing: sharing, access: access,
                                    onShared: { _ in })
        model.prompt = prompt
        if let error {
            sharing.nextError = error
            Task { await model.share() }
        }
        self.model = model
    }

    var body: some View {
        NavigationStack {
            ShareScreen(model: model, look: MascotLook(mascot: .fox, color: .original, accessory: .headphones))
        }
    }
}

#Preview("Share") { SharePreviewScreen() }
#Preview("Share, dark") { SharePreviewScreen().preferredColorScheme(.dark) }
#Preview("Share, AX5") { SharePreviewScreen().dynamicTypeSize(.accessibility5) }
#Preview("Share, no name") { SharePreviewScreen(lastViewerName: nil) }
#Preview("Share, Precise off") { SharePreviewScreen(precise: false) }
#Preview("Share, offline") { SharePreviewScreen(error: .offline) }
#Preview("Share, Precise off alert") { SharePreviewScreen(precise: false, prompt: .preciseOff) }
