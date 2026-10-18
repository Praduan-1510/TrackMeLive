import SwiftUI
import TMLCore

/// The mascot picker (prototype `viewPicker`): the chosen mascot on its stage, then character,
/// color and accessory. From the Mascot tab, Save stays pinned above the tab bar; after sign-up,
/// Continue sits at the end. Content only: the tab or onboarding supplies the navigation stack.
struct MascotPickerScreen: View {
    @Bindable var model: MascotPickerModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("It marks where you are on the map, for you and whoever follows you.")
                    .font(.callout)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let note = model.nextShareNote {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(TMLColor.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, TMLSpacing.space3)
                }

                MascotArt(look: model.draft, size: stageSize, haloScale: 1, bobs: true, spokenName: model.draft.spokenName)
                    .frame(maxWidth: .infinity)
                    .frame(height: stageSize + TMLSpacing.space4)
                    .padding(.top, TMLSpacing.space2)

                SectionLabel("Character")
                    .padding(.top, TMLSpacing.space3)
                    .padding(.bottom, TMLSpacing.space2)
                ChoicePicker("Character set", selection: $model.browsingSet, options: MascotSet.allCases,
                             showsTitle: false) { $0.name }
                MascotGrid(model: model)
                    .padding(.top, TMLSpacing.space3)

                SectionLabel("Color")
                    .padding(.top, TMLSpacing.space5)
                    .padding(.bottom, TMLSpacing.space2)
                SwatchPicker(model: model)

                SectionLabel("Accessory")
                    .padding(.top, TMLSpacing.space5)
                    .padding(.bottom, TMLSpacing.space2)
                AccessoryPicker(model: model)

                if model.mode == .onboarding {
                    SaveControls(model: model)
                        .padding(.top, TMLSpacing.space8)
                }
            }
            .padding(.bottom, TMLSpacing.space6)
        }
        .screenMargins()
        .background(TMLColor.ground)
        .navigationTitle("Your mascot")
        .navigationBarTitleDisplayMode(.large)
        .safeAreaBar(edge: .bottom) {
            if model.mode == .tab {
                SaveControls(model: model)
                    .screenMargins()
                    .padding(.bottom, TMLSpacing.space2)
            }
        }
        .sensoryFeedback(.selection, trigger: model.draft)
        .sensoryFeedback(.success, trigger: model.saveCount)
        .onChange(of: model.saveCount) {
            AccessibilityNotification.Announcement("Saved").post()
        }
        .onChange(of: model.error) { _, error in
            if let error { AccessibilityNotification.Announcement(error.message).post() }
        }
        .tint(TMLColor.ink)
    }

    /// The stage gives way at the accessibility sizes, so the choices stay near the top.
    private var stageSize: CGFloat { dynamicTypeSize.isAccessibilitySize ? 112 : 152 }
}

/// Save (or Continue) with the reason the last try failed above it, next to what went wrong.
private struct SaveControls: View {
    let model: MascotPickerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TMLSpacing.space2) {
            if let error = model.error {
                ErrorLine(message: error.message)
            }
            PrimaryButton(LocalizedStringKey(model.actionTitle), isBusy: model.isSaving) {
                Task { await model.save() }
            }
            .disabled(!model.canSave)
        }
    }
}

/// Four characters to a row, two at the first accessibility sizes, one at the largest, so names
/// never break. The tiles show each character in the chosen color.
private struct MascotGrid: View {
    let model: MascotPickerModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let count = dynamicTypeSize >= .accessibility3 ? 1 : dynamicTypeSize.isAccessibilitySize ? 2 : 4
        let columns = Array(repeating: GridItem(.flexible(), spacing: TMLSpacing.space2, alignment: .top), count: count)
        LazyVGrid(columns: columns, spacing: TMLSpacing.space2) {
            ForEach(model.mascots) { mascot in
                MascotTile(mascot: mascot, color: model.draft.color, selected: mascot == model.draft.mascot) {
                    model.choose(mascot)
                }
            }
        }
    }
}

/// One character. The chosen tile gets a check badge and a 2pt `lamplight-text` border (5.72:1
/// on `surface`), so the choice never rests on color alone.
private struct MascotTile: View {
    let mascot: Mascot
    let color: TMLMascotColor
    let selected: Bool
    let action: () -> Void
    @ScaledMetric(relativeTo: .footnote) private var badge: CGFloat = 20

    var body: some View {
        Button(action: action) {
            VStack(spacing: TMLSpacing.space1) {
                MascotImage(look: MascotLook(mascot: mascot, color: color), size: 62)
                Text(mascot.name)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(TMLColor.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, TMLSpacing.space2)
            .padding(.bottom, TMLSpacing.space3)
            .padding(.horizontal, TMLSpacing.space1)
            .frame(maxWidth: .infinity, minHeight: TMLSpacing.tapTarget)
            .background(selected ? TMLColor.lamplightWash : TMLColor.surface,
                        in: .rect(cornerRadius: TMLRadius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: TMLRadius.md, style: .continuous)
                    .strokeBorder(selected ? TMLColor.lamplightText : TMLColor.separator, lineWidth: selected ? 2 : 1)
            }
            .overlay(alignment: .topTrailing) {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: badge * 0.55, weight: .bold))
                        .foregroundStyle(TMLColor.onLamplight)
                        .frame(width: badge, height: badge)
                        .background(TMLColor.lamplight, in: .circle)
                        .padding(TMLSpacing.space1)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(.rect(cornerRadius: TMLRadius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(mascot.name))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The five colors as 44pt swatches. The chosen one has a check and an `ink` ring outside a
/// `ground` gap; VoiceOver reads the color's name and Selected.
private struct SwatchPicker: View {
    let model: MascotPickerModel

    var body: some View {
        FlowLayout(spacing: TMLSpacing.space3, lineSpacing: TMLSpacing.space3) {
            ForEach(TMLMascotColor.allCases) { color in
                Swatch(rgba: MascotSwatch.rgba(color, for: model.draft.mascot), name: color.name,
                       selected: color == model.draft.color) {
                    model.choose(color)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Color"))
    }
}

private struct Swatch: View {
    let rgba: TMLRGBA
    let name: String
    let selected: Bool
    let action: () -> Void
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(Color(tml: rgba))
                .overlay {
                    Circle().strokeBorder(contrast == .increased ? TMLColor.inkTertiary : TMLColor.separator, lineWidth: 1)
                }
                .overlay {
                    if selected {
                        Image(systemName: "checkmark")
                            .font(.body.weight(.bold))
                            .foregroundStyle(Color(tml: MascotSwatch.checkGlyph(on: rgba)))
                    }
                }
                .frame(width: TMLSpacing.tapTarget, height: TMLSpacing.tapTarget)
                // The ring sits outside a 3pt gap; it's always laid out, so choosing never moves anything.
                .padding(3)
                .overlay {
                    Circle().strokeBorder(selected ? TMLColor.ink : .clear, lineWidth: 2)
                }
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(name))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// None and the accessories this character takes, as chips that wrap. The astronaut takes none,
/// and the row says so.
private struct AccessoryPicker: View {
    let model: MascotPickerModel

    var body: some View {
        if let note = model.accessoryNote {
            Text(note)
                .font(.subheadline)
                .foregroundStyle(TMLColor.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, TMLSpacing.space1)
        } else {
            FlowLayout(spacing: TMLSpacing.space2, lineSpacing: TMLSpacing.space2) {
                ForEach(model.accessoryOptions, id: \.self) { accessory in
                    AccessoryChip(title: accessory?.name ?? "None", selected: accessory == model.draft.accessory) {
                        model.choose(accessory: accessory)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Accessory"))
        }
    }
}

private struct AccessoryChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TMLSpacing.space1) {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(TMLColor.lamplightText)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(TMLColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, TMLSpacing.space4)
            .padding(.vertical, TMLSpacing.space2)
            .frame(minHeight: TMLSpacing.tapTarget)
            .background(selected ? TMLColor.lamplightWash : TMLColor.surface, in: .capsule)
            .overlay {
                Capsule().strokeBorder(selected ? TMLColor.lamplightText : TMLColor.separator, lineWidth: selected ? 2 : 1)
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The picker from the tab while sharing, and after sign-up, for the previews.
private struct MascotPickerPreview: View {
    let model: MascotPickerModel

    init(mode: MascotPickerModel.Mode, look: MascotLook = MascotLook(mascot: .fox, color: .lagoon, accessory: .glasses)) {
        model = MascotPickerModel(look: look, isSharing: mode == .tab, profile: FakeProfileService(), mode: mode)
    }

    var body: some View {
        NavigationStack { MascotPickerScreen(model: model) }
    }
}

#Preview("Mascot tab") { MascotPickerPreview(mode: .tab) }
#Preview("Mascot tab, dark") { MascotPickerPreview(mode: .tab).preferredColorScheme(.dark) }
#Preview("Mascot tab, AX5") { MascotPickerPreview(mode: .tab).dynamicTypeSize(.accessibility5) }
#Preview("After sign-up, astronaut") {
    MascotPickerPreview(mode: .onboarding, look: MascotLook(mascot: .astronaut))
}
