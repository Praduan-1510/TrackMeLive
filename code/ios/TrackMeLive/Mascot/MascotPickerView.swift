import SwiftUI
import TMLCore

/// The Mascot tab (prototype `viewPicker` from the tab): the chosen mascot on its stage, the
/// character set, and four characters per set. Save stays pinned above the tab bar.
///
/// Sprint 0 covers the character. Color and accessory (the renders and layers in
/// design-system/assets/Mascots/colors and accessories) come with the profile work.
struct MascotPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var draft: Mascot = .default
    @State private var set: MascotSet = .classics

    private var changed: Bool { draft != model.mascot }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("It marks where you are on the map, for you and whoever follows you.")
                        .font(.callout)
                        .foregroundStyle(TMLColor.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    MascotArt(mascot: draft, size: 152, haloScale: 1, bobs: true)
                        .frame(maxWidth: .infinity)
                        .frame(height: 168)
                        .padding(.top, TMLSpacing.space2)

                    SectionLabel("Character")
                        .padding(.top, TMLSpacing.space3)
                        .padding(.bottom, TMLSpacing.space2)
                    Picker("Character set", selection: $set) {
                        ForEach(MascotSet.allCases) { item in
                            Text(item.name).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)

                    MascotGrid(mascots: set.mascots, selection: $draft)
                        .padding(.top, TMLSpacing.space3)
                }
                .padding(.bottom, TMLSpacing.space6)
            }
            .screenMargins()
            .background(TMLColor.ground)
            .navigationTitle("Your mascot")
            .navigationBarTitleDisplayMode(.large)
            .safeAreaInset(edge: .bottom) {
                PrimaryButton("Save") { model.mascot = draft }
                    .disabled(!changed)
                    .screenMargins()
                    .padding(.bottom, TMLSpacing.space2)
            }
        }
        .tint(TMLColor.ink)
        .onAppear {
            draft = model.mascot
            set = model.mascot.set
        }
    }
}

/// Four characters to a row (two at the accessibility text sizes). The selected tile has a check
/// badge and a 2pt lamplight-text border, so the choice never rests on color alone.
private struct MascotGrid: View {
    let mascots: [Mascot]
    @Binding var selection: Mascot
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: TMLSpacing.space2),
                            count: dynamicTypeSize.isAccessibilitySize ? 2 : 4)
        LazyVGrid(columns: columns, spacing: TMLSpacing.space2) {
            ForEach(mascots) { mascot in
                MascotTile(mascot: mascot, selected: mascot == selection) {
                    selection = mascot
                }
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}

private struct MascotTile: View {
    let mascot: Mascot
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: TMLSpacing.space1) {
                Image(mascot.renderAssetName)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 62, height: 62)
                Text(mascot.name)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(TMLColor.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(1)
            }
            .padding(.top, TMLSpacing.space2)
            .padding(.bottom, TMLSpacing.space3)
            .padding(.horizontal, TMLSpacing.space1)
            .frame(maxWidth: .infinity, minHeight: TMLSpacing.tapTarget)
            .background(selected ? TMLColor.lamplightWash : TMLColor.surface,
                        in: .rect(cornerRadius: TMLRadius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: TMLRadius.md, style: .continuous)
                    .strokeBorder(selected ? TMLColor.lamplightText : TMLColor.separator,
                                  lineWidth: selected ? 2 : 1)
            }
            .overlay(alignment: .topTrailing) {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(TMLColor.onLamplight)
                        .frame(width: 20, height: 20)
                        .background(TMLColor.lamplight, in: .circle)
                        .padding(TMLSpacing.space1)
                }
            }
            .contentShape(.rect(cornerRadius: TMLRadius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(mascot.name)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

#Preview("Mascot") {
    MascotPickerView().environment(AppModel(defaults: UserDefaults(suiteName: "preview")!))
}
