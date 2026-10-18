import SwiftUI
import TMLCore

/// Home, not on a call and not sharing (prototype `viewHome`): a greeting with the profile's name,
/// the not-on-a-call card, the mascot card (it opens the Mascot tab) and Share live location. Call
/// detection and sharing come in the next sprints.
struct HomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.homePath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(Self.greeting(for: .now))
                        .font(.subheadline)
                        .foregroundStyle(TMLColor.inkSecondary)
                        .padding(.top, TMLSpacing.space2)
                    // The name is direction-isolated, so a right-to-left name never reorders the greeting.
                    Text("Hi, \(PersonName.isolated(model.profile?.name ?? ""))")
                        .displayFont(.largeTitle)
                        .foregroundStyle(TMLColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)

                    CallCard()
                        .padding(.top, TMLSpacing.space4)

                    Button {
                        model.selectedTab = .mascot
                    } label: {
                        MascotCard(look: model.profile.map(MascotLook.init(user:)) ?? .default)
                    }
                    .buttonStyle(CardButtonStyle())
                    .accessibilityHint("Opens the Mascot tab")
                    .padding(.top, TMLSpacing.space4)

                    PrimaryButton("Share live location", systemImage: "location.fill") {
                        model.homePath.append(.share)
                    }
                    .padding(.top, TMLSpacing.space6)

                    Text("You\u{2019}ll choose who gets the link.")
                        .font(.caption)
                        .foregroundStyle(TMLColor.inkSecondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.top, TMLSpacing.space2)
                }
                .padding(.bottom, TMLSpacing.space8)
            }
            .screenMargins()
            .background(TMLColor.ground)
            .toolbarVisibility(.hidden, for: .navigationBar)
            .navigationTitle("Home")
            .navigationDestination(for: HomeDestination.self) { destination in
                switch destination {
                case .share: ShareStubView()
                }
            }
        }
        .tint(TMLColor.ink)
    }

    static func greeting(for date: Date, calendar: Calendar = .current) -> LocalizedStringKey {
        switch calendar.component(.hour, from: date) {
        case 5..<12: "Good morning"
        case 12..<17: "Good afternoon"
        default: "Good evening"
        }
    }
}

/// Not on a call: what happens when one starts, and the one-tap control.
private struct CallCard: View {
    var body: some View {
        Card {
            Label {
                Text("Not on a call")
            } icon: {
                Image(systemName: "phone.fill").symbolRenderingMode(.hierarchical)
            }
            .font(.subheadline.weight(.bold))
            .foregroundStyle(TMLColor.inkSecondary)

            Text("When you\u{2019}re on a call with Track Me Live open, we\u{2019}ll offer to share your location. You can also add a one-tap control.")
                .font(.subheadline)
                .foregroundStyle(TMLColor.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The mascot that marks you on the map. Side by side; stacked at the accessibility text sizes.
private struct MascotCard: View {
    let look: MascotLook
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Card {
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: TMLSpacing.space4))
                : AnyLayout(HStackLayout(alignment: .center, spacing: TMLSpacing.space4))
            layout {
                MascotArt(look: look, size: 108, haloScale: 104 / 108)
                    .frame(width: 116, height: 116)
                VStack(alignment: .leading, spacing: TMLSpacing.space1) {
                    Text(look.mascot.name)
                        .displayFont(.title2)
                        .foregroundStyle(TMLColor.ink)
                    Text("Your marker on the map.")
                        .font(.subheadline)
                        .foregroundStyle(TMLColor.inkSecondary)
                    StatusPill(kind: .notSharing)
                        .padding(.top, TMLSpacing.space2)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(TMLColor.inkTertiary)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A card that's also a button: it dims a little while pressed, without moving (no layout shift).
private struct CardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
            .contentShape(.rect(cornerRadius: TMLRadius.lg))
    }
}

/// Where Share live location leads. The share screen (who it's for, Stops, Location, share back)
/// and the session it starts arrive with the location and backend work.
struct ShareStubView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TMLSpacing.space2) {
                Text("Share where you are")
                    .displayFont(.largeTitle)
                    .foregroundStyle(TMLColor.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Whoever gets the link follows you live in their browser. No app needed.")
                    .font(.callout)
                    .foregroundStyle(TMLColor.inkSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, TMLSpacing.space2)
        }
        .screenMargins()
        .background(TMLColor.ground)
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview("Home") {
    HomeView().environment(AppModel.preview(mascot: .neko))
}
