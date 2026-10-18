import Foundation
import Observation
import SwiftUI

/// Settings (FSD §4; prototype `viewSettings`).
///
/// - The account's settings (`users.settings`) change on screen at once and save to the profile in
///   the background, newest first: a burst of switches sends one save after the one in flight. If
///   a save fails, the screen goes back to what the profile holds and says why.
/// - Appearance stays on this device (`SettingsStore`).
/// - Permissions show what iOS says, and their rows open the explainer, the system prompt, or the
///   way to Settings.
/// - Delete account asks first, then deletes everything and starts the app over.
@MainActor
@Observable
public final class SettingsModel {
    /// The account's settings as the switches show them.
    public private(set) var settings: TMLUserSettings
    /// System, Light or Dark, on this device only.
    public var appearance: AppearancePreference {
        didSet { if appearance != oldValue { deviceSettings.appearance = appearance } }
    }
    /// Why the last change didn't save. Cleared by the next change that does.
    public private(set) var saveError: ProfileError?
    /// The profile listener keeps failing (`ProfileStore.updatesUnavailable`), so these values may be
    /// out of date. The app sets it; the screen shows `profileUpdatesNote`.
    public var profileUpdatesUnavailable = false

    /// A quiet note at the top of Settings while the profile can't update. Polite: it's no error of theirs.
    public var profileUpdatesNote: String? {
        profileUpdatesUnavailable
            ? String(localized: "Can\u{2019}t update your profile right now.", bundle: .module)
            : nil
    }

    /// The explainer or alert a permission row opened.
    public var prompt: PermissionPrompt?

    /// The delete confirmation is showing.
    public var isConfirmingDelete = false
    public private(set) var isDeleting = false
    /// Why deleting failed, for its alert; set to nil to dismiss.
    public var deleteError: ProfileError?

    public let permissions: any PermissionsService

    @ObservationIgnored private let profile: any ProfileService
    @ObservationIgnored private let deviceSettings: any SettingsStore
    @ObservationIgnored private let onAccountDeleted: @MainActor () -> Void
    /// What the profile holds, as far as this screen knows.
    @ObservationIgnored private var confirmed: TMLUserSettings
    @ObservationIgnored private var saving: Task<Void, Never>?
    @ObservationIgnored private var needsAnotherSave = false

    public init(settings: TMLUserSettings, profile: any ProfileService, deviceSettings: any SettingsStore,
                permissions: any PermissionsService, onAccountDeleted: @escaping @MainActor () -> Void = {}) {
        self.settings = settings
        self.confirmed = settings
        self.profile = profile
        self.deviceSettings = deviceSettings
        self.appearance = deviceSettings.appearance
        self.permissions = permissions
        self.onAccountDeleted = onAccountDeleted
    }

    // MARK: The account's settings

    /// Changes one setting and saves it.
    public func set<Value: Equatable>(_ keyPath: WritableKeyPath<TMLUserSettings, Value>, to value: Value) {
        guard settings[keyPath: keyPath] != value else { return }
        settings[keyPath: keyPath] = value
        saveError = nil
        scheduleSave()
    }

    /// A binding for a switch or picker.
    public func binding<Value: Equatable>(_ keyPath: WritableKeyPath<TMLUserSettings, Value>) -> Binding<Value> {
        Binding(get: { self.settings[keyPath: keyPath] }, set: { self.set(keyPath, to: $0) })
    }

    /// Under Location detail when iOS gives the app only approximate locations, whatever is chosen here.
    public var locationDetailNote: String? {
        permissions.location.preciseLocation == false ? "Precise is off in Settings" : nil
    }

    /// The profile changed (another device, or a restore). Taken as is unless a save is running,
    /// whose answer brings the profile up to date anyway.
    public func profileDidChange(_ user: TMLUser) {
        guard saving == nil else { return }
        confirmed = user.settings
        settings = user.settings
    }

    private func scheduleSave() {
        guard saving == nil else {
            needsAnotherSave = true
            return
        }
        saving = Task { await saveUntilCurrent() }
    }

    private func saveUntilCurrent() async {
        repeat {
            needsAnotherSave = false
            let sending = settings
            do {
                try await profile.save(settings: sending)
                confirmed = sending
                saveError = nil
            } catch {
                saveError = error
                // A newer change goes out next and carries this one with it; otherwise undo on screen.
                if !needsAnotherSave { settings = confirmed }
            }
        } while needsAnotherSave
        saving = nil
    }

    /// Waits for saves in flight (tests).
    func waitForSaves() async {
        await saving?.value
    }

    // MARK: Permissions

    public var locationRow: PermissionRow { PermissionRow(permissions.location) }
    public var notificationsRow: PermissionRow { PermissionRow(permissions.notifications) }

    public func refreshPermissions() async {
        await permissions.refresh()
    }

    public func tapLocation() async {
        switch locationRow.action {
        case .explain: prompt = .locationExplainer
        case .ask: await permissions.requestLocation()
        case .openSettings: prompt = .locationOff
        case nil: break
        }
    }

    public func tapNotifications() async {
        switch notificationsRow.action {
        case .explain: prompt = .notificationsExplainer
        case .ask: await permissions.requestNotifications()
        case .openSettings: prompt = .notificationsOff
        case nil: break
        }
    }

    /// Where a confirmed prompt sends the person.
    public enum SystemSettings: Hashable, Sendable {
        /// The app's page in Settings (Location).
        case app
        /// The app's notification settings.
        case notifications
    }

    /// The prompt's main action: an explainer goes on to the system prompt; an Off alert returns
    /// the Settings page to open.
    public func confirm(_ prompt: PermissionPrompt) async -> SystemSettings? {
        self.prompt = nil
        switch prompt {
        case .locationExplainer:
            await permissions.requestLocation()
            return nil
        case .notificationsExplainer:
            await permissions.requestNotifications()
            return nil
        case .locationOff:
            return .app
        case .notificationsOff:
            return .notifications
        }
    }

    // MARK: Delete account

    public func requestDelete() {
        isConfirmingDelete = true
    }

    /// Deletes the account and all its data. The profile store signs out and the app starts over
    /// at onboarding; on failure, `deleteError` says why and nothing is lost.
    public func confirmDelete() async {
        isConfirmingDelete = false
        guard !isDeleting else { return }
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await profile.deleteAccount()
        } catch {
            deleteError = error
            return
        }
        onAccountDeleted()
    }
}

extension AppearancePreference {
    /// The words on Settings › Appearance.
    public var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}
