import Foundation

// The mascot and precision types come from the shared schema (Contracts/TMLSchema.swift: `TMLMascotId`,
// `TMLMascotSet`, `TMLMascotAccessory`, `TMLMascotCatalog`). This file adds what the iOS screens
// need on top: display names, asset names and per-set lists.

/// Short names for the shared mascot types, as the app's screens use them.
public typealias Mascot = TMLMascotId
public typealias MascotSet = TMLMascotSet
public typealias MascotAccessory = TMLMascotAccessory

extension TMLMascotId: Identifiable {
    /// Every account has a mascot; Fox is the default.
    public static var `default`: TMLMascotId { TMLMascotCatalog.defaultMascot }

    public var id: String { rawValue }

    public var name: String {
        switch self {
        case .fox: "Fox"
        case .ghost: "Ghost"
        case .robot: "Robot"
        case .astronaut: "Astronaut"
        case .hero: "Hero"
        case .star: "Star"
        case .ninja: "Ninja"
        case .neko: "Neko"
        case .ace: "Ace"
        case .detective: "Detective"
        case .cowboy: "Cowboy"
        case .agent: "Agent"
        }
    }

    public var set: TMLMascotSet {
        TMLMascotCatalog.all.first { $0.id == self }?.set ?? .classics
    }

    /// The accessories this character can wear. The astronaut's helmet takes none.
    public var accessories: [TMLMascotAccessory] { TMLMascotCatalog.accessories(for: self) }

    /// The 512px render in the app's and the widget's asset catalogs (scripts/export-assets.sh):
    /// onboarding, the picker, avatars and the expanded Live Activity.
    public var renderAssetName: String { "mascot-\(rawValue)" }
    /// The flat SVG for 20pt and below: the compact Live Activity.
    public var flatAssetName: String { "mascot-\(rawValue)-flat" }
}

extension TMLMascotSet: Identifiable {
    public var id: String { rawValue }

    public var name: String {
        switch self {
        case .classics: "Classics"
        case .anime: "Anime"
        case .movie: "Movie night"
        }
    }

    /// The set's four characters, in catalog order.
    public var mascots: [TMLMascotId] {
        TMLMascotCatalog.all.filter { $0.set == self }.map(\.id)
    }
}

extension TMLMascotAccessory: Identifiable {
    public var id: String { rawValue }

    public var name: String {
        switch self {
        case .headphones: "Headphones"
        case .glasses: "Glasses"
        case .headlamp: "Headlamp"
        }
    }
}

extension TMLPrecision: Identifiable {
    public var id: String { rawValue }

    /// The words on the Location detail control.
    public var label: String {
        switch self {
        case .precise: "Precise"
        case .approximate: "Approximate"
        }
    }
}

extension TMLDefaultStop: Identifiable {
    public var id: Self { self }

    /// The words in Settings → Default stop time and on the share screen's Stops row.
    public var label: String {
        switch self {
        case .call: "When the call ends"
        case .minutes15: "In 15 min"
        case .minutes30: "In 30 min"
        case .minutes60: "In 1 hour"
        }
    }

    /// The session's `stop_rule` and `stop_minutes` for a share that starts with this default.
    public var stopRule: (rule: TMLStopRule, minutes: TMLStopMinutes?) {
        switch self {
        case .call: (.call, nil)
        case .minutes15: (.minutes, .minutes15)
        case .minutes30: (.minutes, .minutes30)
        case .minutes60: (.minutes, .minutes60)
        }
    }
}
