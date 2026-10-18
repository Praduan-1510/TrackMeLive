import SwiftUI
import TMLCore

/// Home (prototype `viewHome`): a greeting with the profile's name, the not-on-a-call card (or,
/// while sharing, the live card that opens the map), the mascot card (it opens the Mascot tab) and
/// Share live location, which runs the location step and pushes the share screen. Home's stack
/// holds the share, live and ended screens (`ShareFlowModel`).
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        if let flow = model.shareFlow {
            HomeStack(flow: flow)
                .onChange(of: scenePhase) { _, phase in
                    // Back from Settings: a share waiting on location carries on.
                    if phase == .active { Task { await flow.appDidBecomeActive() } }
                }
        } else {
            // The profile is still loading.
            NavigationStack { HomeContent(flow: nil) }
                .tint(TMLColor.ink)
        }
    }

    static func greeting(for date: Date, calendar: Calendar = .current) -> LocalizedStringKey {
        switch calendar.component(.hour, from: date) {
        case 5..<12: "Good morning"
        case 12..<17: "Good afternoon"
        default: "Good evening"
        }
    }
}

private struct HomeStack: View {
    @Bindable var flow: ShareFlowModel
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack(path: $flow.path) {
            HomeContent(flow: flow)
                .navigationDestination(for: ShareDestination.self) { screen in
                    destination(screen)
                }
        }
        .tint(TMLColor.ink)
        .locationGatePrompts(flow.gate)
    }

    private var look: MascotLook { model.profile.map(MascotLook.init(user:)) ?? .default }

    @ViewBuilder private func destination(_ screen: ShareDestination) -> some View {
        switch screen {
        case .share:
            if let setup = flow.setup {
                ShareScreen(model: setup, look: look)
            }
        case .live:
            LiveScreen(flow: flow, model: flow.live, look: look)
        case .ended:
            if let ended = flow.sharing.state.ended {
                EndedScreen(flow: flow, ended: ended, look: look)
            }
        }
    }
}

private struct HomeContent: View {
    let flow: ShareFlowModel?
    @Environment(AppModel.self) private var model

    var body: some View {
        let card = flow.flatMap { HomeShareCard(state: $0.sharing.state) }
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(HomeView.greeting(for: .now))
                    .font(.subheadline)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .padding(.top, TMLSpacing.space2)
                // The name is direction-isolated, so a right-to-left name never reorders the greeting.
                Text("Hi, \(PersonName.isolated(model.profile?.name ?? ""))")
                    .displayFont(.largeTitle)
                    .foregroundStyle(TMLColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)

                Group {
                    if let card, let flow {
                        Button {
                            Task { await flow.open(.live) }
                        } label: {
                            LiveCard(card: card)
                        }
                        .buttonStyle(CardButtonStyle())
                        .accessibilityHint("Opens the map")
                    } else {
                        CallCard()
                    }
                }
                .padding(.top, TMLSpacing.space4)

                Button {
                    model.selectedTab = .mascot
                } label: {
                    MascotCard(look: model.profile.map(MascotLook.init(user:)) ?? .default, isSharing: card != nil)
                }
                .buttonStyle(CardButtonStyle())
                .accessibilityHint("Opens the Mascot tab")
                .padding(.top, TMLSpacing.space4)

                if card == nil {
                    PrimaryButton("Share live location", systemImage: "location.fill") {
                        guard let flow else { return }
                        Task { await flow.startShare() }
                    }
                    .disabled(flow == nil)
                    .padding(.top, TMLSpacing.space6)

                    Text("You\u{2019}ll choose who gets the link.")
                        .font(.caption)
                        .foregroundStyle(TMLColor.inkSecondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.top, TMLSpacing.space2)
                }
            }
            .padding(.bottom, TMLSpacing.space8)
        }
        .screenMargins()
        .background(TMLColor.ground)
        .toolbarVisibility(.hidden, for: .navigationBar)
        .navigationTitle("Home")
    }
}

/// While sharing: LIVE, who it's for, and the way back to the map.
private struct LiveCard: View {
    let card: HomeShareCard

    var body: some View {
        Card {
            FlowLayout(spacing: TMLSpacing.space2, lineSpacing: TMLSpacing.space1) {
                StatusBadge(title: "Live", tone: .live)
                Text(verbatim: card.title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(TMLColor.ink)
            }
            Text(verbatim: card.message)
                .font(.subheadline)
                .foregroundStyle(TMLColor.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
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
    var isSharing = false
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
                    StatusPill(kind: isSharing ? .live : .notSharing)
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

private let homeSharing = ShareState.live(.sample(options: ShareOptions(
    viewerName: "Mom", stop: .minutes(.minutes30), shareBack: false, precision: .precise)))

#Preview("Home") {
    HomeView().environment(AppModel.preview(mascot: .neko))
}

#Preview("Home, dark") {
    HomeView().environment(AppModel.preview(mascot: .neko)).preferredColorScheme(.dark)
}

#Preview("Home, AX5") {
    HomeView().environment(AppModel.preview(mascot: .neko)).dynamicTypeSize(.accessibility5)
}

#Preview("Home, sharing") {
    HomeView().environment(AppModel.preview(mascot: .neko, sharing: homeSharing))
}

#Preview("Home, sharing, dark") {
    HomeView().environment(AppModel.preview(mascot: .neko, sharing: homeSharing)).preferredColorScheme(.dark)
}
