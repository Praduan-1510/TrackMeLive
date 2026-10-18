import Foundation
import Observation
import SwiftUI

/// Settings › Appearance (FSD §4). It stays on this device and follows the system by default: never
/// forced dark, even though many walks happen at night.
public enum AppearancePreference: String, Codable, CaseIterable, Identifiable, Sendable {
    case system, light, dark

    public var id: Self { self }

    /// For `.preferredColorScheme(_:)`: nil follows the system.
    public var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// What this device remembers on its own: the account's settings live in the profile instead.
/// Implementations: `UserDefaultsSettingsStore` (the app) and `InMemorySettingsStore` (tests, previews).
@MainActor
public protocol SettingsStore: AnyObject {
    /// Onboarding's three pages are done or skipped; launch goes straight to sign-up.
    var hasOnboarded: Bool { get set }
    /// The new account has been through the mascot picker; launch goes straight to Home.
    var hasChosenMascot: Bool { get set }
    var appearance: AppearancePreference { get set }
    /// This install has launched before. UserDefaults goes with the app when it's deleted, but the
    /// Keychain (where Firebase keeps the sign-in) doesn't, so a first launch without this marker
    /// signs out whatever session the Keychain brought back. `resetAll()` keeps it.
    var hasLaunchedBefore: Bool { get set }
    /// Forgets the onboarding and picker flags and Appearance (not the install marker).
    func resetAll()
}

/// `SettingsStore` in UserDefaults. Observable, so Appearance re-renders the app when it changes.
@Observable
@MainActor
public final class UserDefaultsSettingsStore: SettingsStore {
    @ObservationIgnored private let defaults: UserDefaults

    public var hasOnboarded: Bool {
        didSet { defaults.set(hasOnboarded, forKey: Keys.onboarded) }
    }

    public var hasChosenMascot: Bool {
        didSet { defaults.set(hasChosenMascot, forKey: Keys.chosenMascot) }
    }

    public var appearance: AppearancePreference {
        didSet { defaults.set(appearance.rawValue, forKey: Keys.appearance) }
    }

    public var hasLaunchedBefore: Bool {
        didSet { defaults.set(hasLaunchedBefore, forKey: Keys.launchedBefore) }
    }

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        hasOnboarded = defaults.bool(forKey: Keys.onboarded)
        hasChosenMascot = defaults.bool(forKey: Keys.chosenMascot)
        appearance = defaults.string(forKey: Keys.appearance).flatMap(AppearancePreference.init(rawValue:)) ?? .system
        hasLaunchedBefore = defaults.bool(forKey: Keys.launchedBefore)
    }

    public func resetAll() {
        hasOnboarded = false
        hasChosenMascot = false
        appearance = .system
    }

    enum Keys {
        static let onboarded = "onboarded"
        static let chosenMascot = "chosenMascot"
        static let appearance = "appearance"
        static let launchedBefore = "installMarker"
    }
}

/// `SettingsStore` in memory, for tests and previews.
@Observable
@MainActor
public final class InMemorySettingsStore: SettingsStore {
    public var hasOnboarded: Bool
    public var hasChosenMascot: Bool
    public var appearance: AppearancePreference
    public var hasLaunchedBefore: Bool

    public init(hasOnboarded: Bool = false, hasChosenMascot: Bool = false, appearance: AppearancePreference = .system,
                hasLaunchedBefore: Bool = true) {
        self.hasOnboarded = hasOnboarded
        self.hasChosenMascot = hasChosenMascot
        self.appearance = appearance
        self.hasLaunchedBefore = hasLaunchedBefore
    }

    public func resetAll() {
        hasOnboarded = false
        hasChosenMascot = false
        appearance = .system
    }
}
