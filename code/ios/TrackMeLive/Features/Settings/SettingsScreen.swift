import SwiftUI
import TMLCore
import UIKit

/// Settings (FSD §4; prototype `viewSettings`): a native grouped list of `surface` rows on
/// `ground`, with switches, choices, the permissions as iOS reports them, and Delete account.
/// The large title collapses to inline as the list scrolls, over iOS 27's hard scroll edge.
/// Content only: the Settings tab supplies the navigation stack.
struct SettingsScreen: View {
    @Bindable var model: SettingsModel
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Form {
            if let note = model.profileUpdatesNote {
                Section {
                    Label {
                        Text(verbatim: note).fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                    .font(.footnote)
                    .foregroundStyle(TMLColor.inkSecondary)
                }
                .listRowBackground(TMLColor.surface)
            }

            if let error = model.saveError {
                Section {
                    ErrorLine(message: error.message)
                }
                .listRowBackground(TMLColor.surface)
            }

            Section {
                Toggle(isOn: model.binding(\.offerOnCall)) {
                    RowText("Offer to share when I\u{2019}m on a call", detail: "When Track Me Live is open")
                }
                .tint(TMLColor.lamplight)
                VStack(alignment: .leading, spacing: TMLSpacing.space1) {
                    ChoicePicker("Location detail", selection: model.binding(\.precision), options: TMLPrecision.allCases) { $0.label }
                    if let note = model.locationDetailNote {
                        Text(note)
                            .font(.footnote)
                            .foregroundStyle(TMLColor.inkSecondary)
                    }
                }
                NavigationLink {
                    DefaultStopScreen(model: model)
                } label: {
                    ValueRow(title: "Default stop time", value: model.settings.defaultStop.label)
                }
            } header: {
                SectionHeader("Sharing")
            }
            .listRowBackground(TMLColor.surface)

            Section {
                Toggle(isOn: model.binding(\.shareBack)) {
                    RowText("Let people share back", detail: "Only during a call. Off for each call if you turn it off.")
                }
                .tint(TMLColor.lamplight)
            } header: {
                SectionHeader("Live Together")
            }
            .listRowBackground(TMLColor.surface)

            Section {
                Group {
                    Toggle("When my link is opened", isOn: model.binding(\.alertLinkOpened))
                    Toggle("When a call ends while I\u{2019}m sharing", isOn: model.binding(\.alertCallEnded))
                    Toggle("When sharing expires", isOn: model.binding(\.alertExpiry))
                }
                .tint(TMLColor.lamplight)
            } header: {
                SectionHeader("Alerts")
            }
            .listRowBackground(TMLColor.surface)

            Section {
                ChoicePicker("Appearance", selection: $model.appearance, options: AppearancePreference.allCases,
                             showsTitle: false) { $0.title }
            } header: {
                SectionHeader("Appearance")
            }
            .listRowBackground(TMLColor.surface)

            Section {
                PermissionRowView(row: model.locationRow) { await model.tapLocation() }
                PermissionRowView(row: model.notificationsRow) { await model.tapNotifications() }
            } header: {
                SectionHeader("Permissions")
            } footer: {
                SectionFooter("""
                    Sharing starts while the app is open and keeps going in the background until it stops. \
                    If Live Activities are off, sharing still works, and the location arrow in the status bar shows it.
                    """)
            }
            .listRowBackground(TMLColor.surface)

            Section {
                Button(role: .destructive) {
                    model.requestDelete()
                } label: {
                    HStack(spacing: TMLSpacing.space2) {
                        if model.isDeleting { ProgressView().accessibilityHidden(true) }
                        Text("Delete account and all data")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(TMLColor.flareText)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, minHeight: TMLSpacing.tapTarget)
                }
                .disabled(model.isDeleting)
                .accessibilityValue(model.isDeleting ? Text("In progress") : Text(verbatim: ""))
            } header: {
                SectionHeader("Your data")
            } footer: {
                SectionFooter("""
                    Location points are deleted 24 hours after a session ends. \
                    Session details are kept for 30 days, then deleted.
                    """)
            }
            .listRowBackground(TMLColor.surface)
        }
        // Switches are lamplight, as in the prototype; everything else is ink, never crossing blue.
        .tint(TMLColor.ink)
        .scrollContentBackground(.hidden)
        .background(TMLColor.ground)
        .foregroundStyle(TMLColor.ink)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
        .scrollEdgeEffectStyle(.hard, for: .top)
        .alert("Delete your account?", isPresented: $model.isConfirmingDelete) {
            Button("Delete", role: .destructive) { Task { await model.confirmDelete() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes your profile, mascot and every session right away. You can\u{2019}t undo it.")
        }
        .alert("Your account wasn\u{2019}t deleted", isPresented: isShowing(\.deleteError), presenting: model.deleteError) { _ in
            Button("OK", role: .cancel) {}
        } message: { error in
            Text(error.message)
        }
        .alert(offAlert?.title ?? "", isPresented: isShowingOffAlert, presenting: offAlert) { prompt in
            Button(prompt.confirmTitle) { Task { await confirm(prompt) } }
            Button(prompt.cancelTitle, role: .cancel) {}
        } message: { prompt in
            Text(prompt.message)
        }
        .sheet(item: explainer) { prompt in
            PermissionExplainer(prompt: prompt) {
                Task { await confirm(prompt) }
            } onNotNow: {
                model.prompt = nil
            }
        }
        .onChange(of: model.profileUpdatesNote) { _, note in
            // Announced politely, once, when it appears.
            guard let note else { return }
            var announcement = AttributedString(note)
            announcement.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(announcement).post()
        }
        .task { await model.refreshPermissions() }
        .onChange(of: scenePhase) { _, phase in
            // Back from Settings: show what changed there.
            if phase == .active { Task { await model.refreshPermissions() } }
        }
        .onChange(of: model.saveError) { _, error in
            if let error { AccessibilityNotification.Announcement(error.message).post() }
        }
    }

    // MARK: Prompts

    private var offAlert: PermissionPrompt? {
        model.prompt.flatMap { $0.isExplainer ? nil : $0 }
    }

    private var isShowingOffAlert: Binding<Bool> {
        Binding(get: { offAlert != nil }, set: { if !$0 { model.prompt = nil } })
    }

    private var explainer: Binding<PermissionPrompt?> {
        Binding(get: { model.prompt.flatMap { $0.isExplainer ? $0 : nil } }, set: { model.prompt = $0 })
    }

    private func isShowing(_ keyPath: ReferenceWritableKeyPath<SettingsModel, ProfileError?>) -> Binding<Bool> {
        Binding(get: { model[keyPath: keyPath] != nil }, set: { if !$0 { model[keyPath: keyPath] = nil } })
    }

    private func confirm(_ prompt: PermissionPrompt) async {
        switch await model.confirm(prompt) {
        case .app:
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        case .notifications:
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
        case nil:
            break
        }
    }
}

/// Settings › Default stop time: the four choices with a check on the chosen one.
private struct DefaultStopScreen: View {
    @Bindable var model: SettingsModel

    var body: some View {
        Form {
            Section {
                Picker("Default stop time", selection: model.binding(\.defaultStop)) {
                    ForEach(TMLDefaultStop.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } footer: {
                SectionFooter("Sharing never runs longer than 1 hour.")
            }
            .listRowBackground(TMLColor.surface)
        }
        .tint(TMLColor.ink)
        .scrollContentBackground(.hidden)
        .background(TMLColor.ground)
        .foregroundStyle(TMLColor.ink)
        .navigationTitle("Default stop time")
        .navigationBarTitleDisplayMode(.inline)
        .scrollEdgeEffectStyle(.hard, for: .top)
    }
}

/// One Permissions row: the state iOS reports, and a chevron when tapping does something.
/// Allowed rows aren't buttons, so VoiceOver doesn't offer an action that does nothing.
private struct PermissionRowView: View {
    let row: PermissionRow
    let action: () async -> Void

    var body: some View {
        if row.action != nil {
            Button {
                Task { await action() }
            } label: {
                ValueRow(title: row.title, detail: row.detail, value: row.value, showsChevron: true)
            }
            .accessibilityHint(Text(row.hint ?? ""))
        } else {
            ValueRow(title: row.title, detail: row.detail, value: row.value)
        }
    }
}

/// A row with a title (and an optional second line) and its value on the trailing side; at the
/// accessibility sizes the value moves under the title, so neither truncates.
private struct ValueRow: View {
    let title: String
    var detail: String?
    let value: String
    var showsChevron = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: TMLSpacing.space1))
            : AnyLayout(HStackLayout(alignment: .center, spacing: TMLSpacing.space3))
        HStack(spacing: TMLSpacing.space2) {
            layout {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(TMLColor.ink)
                    if let detail {
                        Text(detail)
                            .font(.footnote)
                            .foregroundStyle(TMLColor.inkSecondary)
                    }
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                Text(value)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
            }
            .fixedSize(horizontal: false, vertical: true)
            if showsChevron {
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(TMLColor.inkTertiary)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: TMLSpacing.tapTarget)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text([value, detail].compactMap(\.self).joined(separator: ", ")))
    }
}

/// A switch's title with a line of detail under it.
private struct RowText: View {
    let title: LocalizedStringKey
    let detail: LocalizedStringKey

    init(_ title: LocalizedStringKey, detail: LocalizedStringKey) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).foregroundStyle(TMLColor.ink)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(TMLColor.inkSecondary)
        }
    }
}

/// A section header in sentence case, as in the prototype.
private struct SectionHeader: View {
    let title: LocalizedStringKey

    init(_ title: LocalizedStringKey) { self.title = title }

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(TMLColor.inkSecondary)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct SectionFooter: View {
    let text: LocalizedStringKey

    init(_ text: LocalizedStringKey) { self.text = text }

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(TMLColor.inkSecondary)
    }
}

/// Settings with fixed permission states, for the previews.
private struct SettingsPreview: View {
    let model: SettingsModel

    init(location: LocationPermission = .whileUsing(precise: false), notifications: NotificationPermission = .off) {
        model = SettingsModel(settings: .defaults, profile: FakeProfileService(), deviceSettings: InMemorySettingsStore(),
                              permissions: FixedPermissionsService(location: location, notifications: notifications))
    }

    var body: some View {
        NavigationStack { SettingsScreen(model: model) }
    }
}

#Preview("Settings") { SettingsPreview() }
#Preview("Settings, dark") { SettingsPreview(location: .notSet, notifications: .allowed).preferredColorScheme(.dark) }
#Preview("Settings, AX5") { SettingsPreview().dynamicTypeSize(.accessibility5) }
