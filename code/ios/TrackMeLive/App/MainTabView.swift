import SwiftUI
import TMLCore

/// Home, Mascot and Settings in the system tab bar, which floats as Liquid Glass on iOS 26 and later.
/// Each tab keeps its own navigation stack, so switching tabs never loses where someone was.
struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                HomeView()
            }
            Tab("Mascot", systemImage: "cat", value: AppTab.mascot) {
                NavigationStack {
                    if let picker = model.mascotTab {
                        MascotPickerScreen(model: picker)
                    }
                }
            }
            Tab("Settings", systemImage: "slider.horizontal.3", value: AppTab.settings) {
                NavigationStack {
                    if let settings = model.settingsTab {
                        SettingsScreen(model: settings)
                    }
                }
            }
        }
        // The selected tab reads in lamplight-text, as in the prototype; content resets the tint to ink.
        .tint(TMLColor.lamplightText)
        // A share ending (Stop, the timer, the limit, the server) shows the ended screen on Home.
        .onChange(of: model.dependencies.sharing.state) { model.shareStateDidChange() }
    }
}

#Preview("Tabs") {
    MainTabView().environment(AppModel.preview())
}

#Preview("Tabs, sharing") {
    MainTabView().environment(AppModel.preview(sharing: .live(.sample(options: ShareOptions(
        viewerName: "Mom", stop: .minutes(.minutes30), shareBack: false, precision: .precise)))))
}
