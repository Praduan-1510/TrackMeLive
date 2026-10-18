import SwiftUI
import TMLCore

/// Whichever part of the app the account is in: launch, onboarding, sign-up, the new account's
/// mascot, or the tabs (`AccountModel.Route`).
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let account = model.account
        ZStack {
            switch account.route {
            case .launch:
                LaunchView()
                    .transition(.opacity)
            case .onboarding:
                if let onboarding = account.onboarding {
                    OnboardingView(model: onboarding)
                        .transition(.opacity)
                }
            case .signUp:
                if let signUp = account.signUp {
                    SignUpView(model: signUp, onLeave: { account.leaveSignUp() })
                        // A new flow each time sign-up starts over.
                        .id(ObjectIdentifier(signUp))
                        .transition(.opacity)
                }
            case .chooseMascot:
                if let picker = model.mascotSetup {
                    NavigationStack {
                        MascotPickerScreen(model: picker)
                    }
                    .transition(.opacity)
                }
            case .main:
                MainTabView()
                    .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.35), value: account.route)
        .onChange(of: account.route, initial: true) { model.routeDidChange() }
        .onChange(of: account.profiles.profile) { model.profileDidChange() }
        .onChange(of: account.profiles.updatesUnavailable) { model.profileUpdatesDidChange() }
        // Settings › Appearance. System follows the device; never forced dark.
        .preferredColorScheme(model.appearance.colorScheme)
    }
}

/// While the sign-in and the profile are restored: the brand mark on the launch color, then, if it
/// takes a while, a calm line about it. A profile that can't load offers Try again.
private struct LaunchView: View {
    @Environment(AppModel.self) private var model
    @State private var isSlow = false

    var body: some View {
        VStack(spacing: TMLSpacing.space5) {
            Spacer()
            Image("brand-mark")
                .resizable()
                .scaledToFit()
                .frame(width: 96)
                .accessibilityLabel("Track Me Live")
            if let failure = model.account.launchFailure {
                VStack(spacing: TMLSpacing.space4) {
                    ErrorLine(message: failure.loadMessage)
                    PlainInkButton("Try again") { model.account.retryLaunch() }
                }
                .multilineTextAlignment(.center)
            } else if isSlow {
                ProgressView("Getting your profile\u{2026}")
                    .font(.footnote)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .tint(TMLColor.inkSecondary)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .screenMargins()
        .background(TMLColor.ground)
        .task {
            // Quick restores never show the line.
            try? await Task.sleep(for: .seconds(2))
            isSlow = true
        }
    }
}

private extension ProfileError {
    /// The launch screen's line when the profile can't be read.
    var loadMessage: String {
        switch self {
        case .offline:
            String(localized: "We couldn\u{2019}t get your profile. Check your connection, then try again.")
        default:
            String(localized: "We couldn\u{2019}t get your profile. Try again in a moment.")
        }
    }
}

#Preview("Launch") {
    RootView().environment(AppModel.preview(signedIn: true))
}
