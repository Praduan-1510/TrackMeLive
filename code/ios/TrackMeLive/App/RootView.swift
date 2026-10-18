import SwiftUI
import TMLCore

/// Onboarding until it's done, then the three tabs.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            if model.hasOnboarded {
                MainTabView()
                    .transition(.opacity)
            } else {
                OnboardingView()
                    .transition(.opacity)
            }
        }
        .animation(.smooth(duration: 0.35), value: model.hasOnboarded)
        // Settings → Appearance. System follows the device; never forced dark.
        .preferredColorScheme(model.settings.appearance.colorScheme)
    }
}

/// Home, Mascot and Settings in the system tab bar, which floats as Liquid Glass on iOS 26 and later.
struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                HomeView()
            }
            Tab("Mascot", systemImage: "cat", value: AppTab.mascot) {
                MascotPickerView()
            }
            Tab("Settings", systemImage: "slider.horizontal.3", value: AppTab.settings) {
                SettingsView()
            }
        }
        // The selected tab reads in lamplight-text, as in the prototype; content resets the tint to ink.
        .tint(TMLColor.lamplightText)
    }
}
