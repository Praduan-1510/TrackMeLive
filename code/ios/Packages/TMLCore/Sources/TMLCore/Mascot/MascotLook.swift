import Foundation

/// One person's mascot as it is drawn: the character, its color and, optionally, an accessory.
///
/// The profile (`users/{uid}`) and every session's `sharer` snapshot hold these three fields; a
/// share keeps the look it started with. A look is always valid: an accessory the character can't
/// wear is dropped (the server rejects it too, as `mascot_accessory`).
public struct MascotLook: Hashable, Sendable, Codable {
    /// Changing the character drops an accessory the new one can't wear, as the picker does.
    public var mascot: TMLMascotId {
        didSet { if !TMLMascotCatalog.takes(mascot, accessory) { accessory = nil } }
    }
    public var color: TMLMascotColor
    /// Nil for none. Setting one the character can't wear leaves none.
    public var accessory: TMLMascotAccessory? {
        didSet { if !TMLMascotCatalog.takes(mascot, accessory) { accessory = nil } }
    }

    public init(mascot: TMLMascotId, color: TMLMascotColor = TMLMascotCatalog.defaultColor,
                accessory: TMLMascotAccessory? = nil) {
        self.mascot = mascot
        self.color = color
        self.accessory = TMLMascotCatalog.takes(mascot, accessory) ? accessory : nil
    }

    /// Every account starts as the Original fox with no accessory.
    public static let `default` = MascotLook(mascot: TMLMascotCatalog.defaultMascot)

    /// The look saved on a profile.
    public init(user: TMLUser) {
        self.init(mascot: user.mascotId, color: user.mascotColor, accessory: user.mascotAccessory)
    }

    /// The look a session started with (what both maps draw for the sharer).
    public init(sharer: TMLSharerSnapshot) {
        self.init(mascot: sharer.mascotId, color: sharer.mascotColor, accessory: sharer.mascotAccessory)
    }

    /// The accessories this look's character can wear, in catalog order.
    public var availableAccessories: [TMLMascotAccessory] { mascot.accessories }

    /// What VoiceOver says for the mascot on its own: "Fox", "Fox, Lagoon, with glasses".
    /// The Original color isn't named; it's every character's own.
    public var spokenName: String {
        var parts = [mascot.name]
        if color != .original { parts.append(color.name) }
        if let accessory { parts.append("with \(accessory.name.lowercased())") }
        return parts.joined(separator: ", ")
    }

    // Codable through the profile's own field names, so a look round-trips with the schema.
    private enum CodingKeys: String, CodingKey {
        case mascot = "mascot_id", color = "mascot_color", accessory = "mascot_accessory"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(mascot: try c.decode(TMLMascotId.self, forKey: .mascot),
                  color: try c.decode(TMLMascotColor.self, forKey: .color),
                  accessory: try c.decodeIfPresent(TMLMascotAccessory.self, forKey: .accessory))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(mascot, forKey: .mascot)
        try c.encode(color, forKey: .color)
        try c.encode(accessory, forKey: .accessory) // null for none: every field is written
    }
}

extension TMLMascotId {
    /// Why the accessory row is empty for a character that takes none.
    /// Only the astronaut has none: its helmet leaves no room.
    public var noAccessoriesNote: String? {
        guard accessories.isEmpty else { return nil }
        return self == .astronaut
            ? "The astronaut\u{2019}s helmet doesn\u{2019}t take accessories."
            : "The \(name.lowercased()) doesn\u{2019}t take accessories."
    }
}

extension TMLMascotColor: Identifiable {
    public var id: String { rawValue }

    /// The color's name in the picker, which VoiceOver reads for its swatch.
    public var name: String {
        switch self {
        case .original: "Original"
        case .moss: "Moss"
        case .lagoon: "Lagoon"
        case .dusk: "Dusk"
        case .rose: "Rose"
        }
    }
}
