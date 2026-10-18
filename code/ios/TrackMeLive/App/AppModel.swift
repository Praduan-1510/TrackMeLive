import Observation
import SwiftUI
import TMLCore

enum AppTab: Hashable {
    case home, mascot, settings
}

/// The app's composition root: the account flow (TMLCore's `AccountModel`), the tabs and their
/// models, and deep links. Views read it from the environment; the logic lives in TMLCore.
@Observable
@MainActor
final class AppModel {
    let account: AccountModel
    @ObservationIgnored let dependencies: AppDependencies

    var selectedTab: AppTab = .home

    /// The Mascot and Settings tabs' models, made once per signed-in account.
    private(set) var mascotTab: MascotPickerModel?
    private(set) var settingsTab: SettingsModel?
    /// Sharing from Home: the location step, then the share, live and ended screens on Home's stack.
    private(set) var shareFlow: ShareFlowModel?
    /// The picker a new account sees after sign-up (onboarding mode).
    private(set) var mascotSetup: MascotPickerModel?

    @ObservationIgnored private var tabsUID: String?
    /// A deep link that arrived before the tabs were on screen (at launch, during onboarding).
    @ObservationIgnored private var pendingRoute: TMLCore.Route?

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        account = AccountModel(
            auth: dependencies.auth,
            profileBackend: dependencies.profileBackend,
            settings: dependencies.settings
        )
        // Restore the sign-in and the profile now, so the first frame is already the right screen.
        account.start()
    }

    // MARK: What the screens show

    var profile: TMLUser? { account.profiles.profile }
    var appearance: AppearancePreference { account.settings.appearance }

    /// Call when `account.route` changes: makes the models the new route needs, and opens a deep link
    /// that was waiting for the tabs.
    func routeDidChange() {
        switch account.route {
        case .chooseMascot:
            if mascotSetup == nil, let profile {
                mascotSetup = MascotPickerModel(
                    look: MascotLook(user: profile), isSharing: false, profile: account.profiles, mode: .onboarding,
                    onFinished: { [weak self] in self?.account.finishMascotSetup() }
                )
            }
        case .main:
            mascotSetup = nil
            makeTabModels()
            if let route = pendingRoute {
                pendingRoute = nil
                open(route)
            }
        case .launch, .onboarding, .signUp:
            mascotSetup = nil
            resetTabs()
        }
    }

    /// Call when the profile changes (another device, or a save answering): the open screens follow.
    func profileDidChange() {
        guard let profile else { return }
        // A model waiting for the profile to load.
        if (account.route == .chooseMascot && mascotSetup == nil) || (account.route == .main && mascotTab == nil) {
            routeDidChange()
        }
        mascotTab?.profileDidChange(profile)
        settingsTab?.profileDidChange(profile)
        mascotSetup?.profileDidChange(profile)
    }

    /// Call when the profile listener stops or starts getting through: Settings says so quietly.
    func profileUpdatesDidChange() {
        settingsTab?.profileUpdatesUnavailable = account.profiles.updatesUnavailable
    }

    private func makeTabModels() {
        guard let profile, let uid = account.user?.uid, tabsUID != uid else { return }
        tabsUID = uid
        mascotTab = MascotPickerModel(
            look: MascotLook(user: profile), isSharing: false, profile: account.profiles, mode: .tab
        )
        settingsTab = SettingsModel(
            settings: profile.settings,
            profile: account.profiles,
            deviceSettings: account.settings,
            permissions: dependencies.permissions,
            onAccountDeleted: { [weak self] in self?.resetTabs() }
        )
        shareFlow = ShareFlowModel(
            sharing: dependencies.sharing,
            access: dependencies.locationAccess,
            permissions: dependencies.permissions,
            profile: { [weak self] in self?.profile }
        )
        profileUpdatesDidChange()
    }

    private func resetTabs() {
        tabsUID = nil
        mascotTab = nil
        settingsTab = nil
        shareFlow = nil
        selectedTab = .home
    }

    /// Call when the share's state changes: the ended screen replaces the live one.
    func shareStateDidChange() {
        shareFlow?.stateDidChange()
    }

    // MARK: Deep links

    /// The Live Activity, the Share location control or a URL. Waits for the tabs if they aren't up.
    func open(_ route: TMLCore.Route) {
        guard account.route == .main else {
            pendingRoute = route
            return
        }
        selectedTab = .home
        // The profile is still loading: open it once the tabs' models exist.
        guard let shareFlow else {
            pendingRoute = route
            return
        }
        Task { await shareFlow.open(route) }
    }

    func handleOpenURL(_ url: URL) {
        // Firebase's reCAPTCHA redirect comes back as a URL, before any deep link handling.
        if dependencies.lifecycle?.handleOpenURL(url) == true { return }
        if let route = TMLCore.Route(url: url) { open(route) }
    }

    func consumePendingRoute() {
        let shared = TMLCore.sharedDefaults
        guard let raw = shared.string(forKey: TMLCore.pendingRouteKey) else { return }
        shared.removeObject(forKey: TMLCore.pendingRouteKey)
        if let route = TMLCore.Route(rawValue: raw) { open(route) }
    }
}

extension AppModel {
    /// For previews: in-memory fakes, signed in on the tabs, or signed out at onboarding.
    static func preview(signedIn: Bool = true, mascot: TMLMascotId = .fox, sharing: ShareState = .idle) -> AppModel {
        AppModel(dependencies: .preview(signedIn: signedIn, mascot: mascot, sharing: sharing))
    }
}
