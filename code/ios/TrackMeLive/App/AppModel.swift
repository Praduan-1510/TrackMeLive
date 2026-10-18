import Observation
import SwiftUI
import TMLCore

enum AppTab: Hashable {
    case home, mascot, settings
}

/// Screens pushed on Home's navigation stack.
enum HomeDestination: Hashable {
    case share
}

/// App state for Sprint 0: onboarding, the chosen mascot, Settings and navigation.
/// Persists to UserDefaults. Sign-up, the profile in Firestore and sessions come later.
@Observable
@MainActor
final class AppModel {
    private let defaults: UserDefaults

    var hasOnboarded: Bool {
        didSet { defaults.set(hasOnboarded, forKey: Keys.onboarded) }
    }

    /// Every account has a mascot; Fox is the default.
    var mascot: Mascot {
        didSet { defaults.set(mascot.rawValue, forKey: Keys.mascot) }
    }

    var settings: AppSettings {
        didSet { settings.save(to: defaults, key: Keys.settings) }
    }

    /// Sample name until sign-up exists (sign-up asks for a name of 1 to 24 characters).
    var profileName = "Alex"

    var selectedTab: AppTab = .home
    var homePath: [HomeDestination] = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        hasOnboarded = defaults.bool(forKey: Keys.onboarded)
        mascot = defaults.string(forKey: Keys.mascot).flatMap(Mascot.init(rawValue:)) ?? .default
        settings = AppSettings.load(from: defaults, key: Keys.settings)
    }

    /// Onboarding's last page. The full flow goes on to sign-up and the mascot picker; until those
    /// exist it lands on Home.
    func finishOnboarding() {
        hasOnboarded = true
        selectedTab = .home
    }

    /// Settings → Delete account and all data. Sprint 0 has only local data: clear it and start
    /// over at onboarding. TODO(backend): call the delete-account function first.
    func deleteAccount() {
        mascot = .default
        settings = AppSettings()
        homePath = []
        selectedTab = .home
        hasOnboarded = false
    }

    /// Opens a deep link from the Live Activity or the Share location control.
    func open(_ route: TMLCore.Route) {
        guard hasOnboarded else { return }
        selectedTab = .home
        switch route {
        case .share:
            homePath = [.share]
        case .live, .stop:
            // TODO(sharing): the live map and the Stop sharing confirmation.
            homePath = []
        }
    }

    func consumePendingRoute() {
        let shared = TMLCore.sharedDefaults
        guard let raw = shared.string(forKey: TMLCore.pendingRouteKey) else { return }
        shared.removeObject(forKey: TMLCore.pendingRouteKey)
        if let route = TMLCore.Route(rawValue: raw) { open(route) }
    }

    private enum Keys {
        static let onboarded = "onboarded"
        static let mascot = "mascot"
        static let settings = "settings"
    }
}

/// Settings (FSD §4 "Settings"): the account's settings from the shared schema (`users.settings`,
/// restored on a new phone) plus Appearance, which stays on this device.
/// Stored on the device until sign-up and the profile sync exist.
struct AppSettings: Codable, Equatable {
    enum Appearance: String, Codable, CaseIterable, Identifiable {
        case system, light, dark
        var id: Self { self }
        var label: String { rawValue.capitalized }
        var colorScheme: ColorScheme? {
            switch self {
            case .system: nil
            case .light: .light
            case .dark: .dark
            }
        }
    }

    /// Offer on a call, Location detail, Default stop time, share back and the three alerts.
    var user = TMLUserSettings.defaults
    var appearance = Appearance.system

    static func load(from defaults: UserDefaults, key: String) -> AppSettings {
        guard let data = defaults.data(forKey: key),
              let settings = try? JSONDecoder().decode(AppSettings.self, from: data) else { return AppSettings() }
        return settings
    }

    func save(to defaults: UserDefaults, key: String) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: key) }
    }
}
