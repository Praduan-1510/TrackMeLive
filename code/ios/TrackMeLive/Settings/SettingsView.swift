import CoreLocation
import SwiftUI
import TMLCore
import UserNotifications

/// Settings (FSD §4; prototype `viewSettings`): a native grouped list of `surface` rows on
/// `ground`, with switches, segmented pickers and the hard scroll edge under the bar.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var confirmDelete = false
    @State private var locationStatus = "Not set"
    @State private var notificationStatus = "Not set"

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: $model.settings.user.offerOnCall) {
                        RowText("Offer to share when I\u{2019}m on a call", detail: "When Track Me Live is open")
                    }
                    .tint(TMLColor.lamplight)
                    VStack(alignment: .leading, spacing: TMLSpacing.space2) {
                        Text("Location detail")
                        Picker("Location detail", selection: $model.settings.user.precision) {
                            ForEach(TMLPrecision.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                    .padding(.vertical, TMLSpacing.space1)
                    Picker("Default stop time", selection: $model.settings.user.defaultStop) {
                        ForEach(TMLDefaultStop.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.menu)
                } header: {
                    header("Sharing")
                }
                .listRowBackground(TMLColor.surface)

                Section {
                    Toggle(isOn: $model.settings.user.shareBack) {
                        RowText("Let people share back", detail: "Only during a call. Off for each call if you turn it off.")
                    }
                    .tint(TMLColor.lamplight)
                } header: {
                    header("Live Together")
                }
                .listRowBackground(TMLColor.surface)

                Section {
                    Toggle("When my link is opened", isOn: $model.settings.user.alertLinkOpened)
                        .tint(TMLColor.lamplight)
                    Toggle("When a call ends while I\u{2019}m sharing", isOn: $model.settings.user.alertCallEnded)
                        .tint(TMLColor.lamplight)
                    Toggle("When sharing expires", isOn: $model.settings.user.alertExpiry)
                        .tint(TMLColor.lamplight)
                } header: {
                    header("Alerts")
                }
                .listRowBackground(TMLColor.surface)

                Section {
                    Picker("Appearance", selection: $model.settings.appearance) {
                        ForEach(AppSettings.Appearance.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .padding(.vertical, TMLSpacing.space1)
                } header: {
                    header("Appearance")
                }
                .listRowBackground(TMLColor.surface)

                Section {
                    Button { openSystemSettings() } label: {
                        LabeledContent("Location", value: locationStatus)
                    }
                    Button { openSystemSettings() } label: {
                        LabeledContent("Notifications", value: notificationStatus)
                    }
                } header: {
                    header("Permissions")
                } footer: {
                    Text("Sharing starts while the app is open and keeps going in the background until it stops. If Live Activities are off, sharing still works, and the location arrow in the status bar shows it.")
                }
                .listRowBackground(TMLColor.surface)

                Section {
                    Button("Delete account and all data", role: .destructive) { confirmDelete = true }
                        .font(.body.weight(.semibold))
                        .foregroundStyle(TMLColor.flareText)
                        .frame(maxWidth: .infinity)
                } header: {
                    header("Your data")
                } footer: {
                    Text("Location points are deleted 24 hours after a session ends. Session details are kept for 30 days, then deleted.")
                }
                .listRowBackground(TMLColor.surface)
            }
            .scrollContentBackground(.hidden)
            .background(TMLColor.ground)
            .foregroundStyle(TMLColor.ink)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
            .scrollEdgeEffectStyle(.hard, for: .top)
            .alert("Delete your account and all data?", isPresented: $confirmDelete) {
                Button("Delete", role: .destructive) { model.deleteAccount() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Any share stops, and your profile, mascot and settings are deleted. This can\u{2019}t be undone.")
            }
            .task { await refreshPermissions() }
        }
        .tint(TMLColor.ink)
    }

    private func header(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(TMLColor.inkSecondary)
            .textCase(nil)
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }

    private func refreshPermissions() async {
        locationStatus = switch CLLocationManager().authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: "While using the app"
        case .denied, .restricted: "Off"
        default: "Not set"
        }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationStatus = switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: "Allowed"
        case .denied: "Off"
        default: "Not set"
        }
    }
}

/// A row title with a line of detail under it.
private struct RowText: View {
    let title: LocalizedStringKey
    let detail: LocalizedStringKey

    init(_ title: LocalizedStringKey, detail: LocalizedStringKey) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(TMLColor.inkSecondary)
        }
    }
}

#Preview("Settings") {
    SettingsView().environment(AppModel(defaults: UserDefaults(suiteName: "preview")!))
}
