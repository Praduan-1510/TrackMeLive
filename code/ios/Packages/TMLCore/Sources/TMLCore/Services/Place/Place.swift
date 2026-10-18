import Foundation

/// The words of "Where Alex is" (FSD §4; x-decisions Q-PLACE): what the sharer's phone looked up
/// for a point, each part cleaned as firestore.rules require. At least one part is set.
///
/// - `name`: a park, landmark or venue at the point ("Yerba Buena Gardens"), never an address.
/// - `street`: the thoroughfare, without a house number ("Mission St").
/// - `area`: the neighbourhood or sub-locality ("Yerba Buena").
/// - `city`: the locality ("San Francisco").
public struct PlaceParts: Hashable, Sendable {
    public let name: String?
    public let street: String?
    public let area: String?
    public let city: String?

    /// Cleans each part (`PlacePart.clean`); nil when no part is left.
    public init?(name: String? = nil, street: String? = nil, area: String? = nil, city: String? = nil) {
        let name = PlacePart.clean(name), street = PlacePart.clean(street)
        let area = PlacePart.clean(area), city = PlacePart.clean(city)
        guard name != nil || street != nil || area != nil || city != nil else { return nil }
        self.name = name
        self.street = street
        self.area = area
        self.city = city
    }

    /// The parts of a place on the session.
    public init?(_ place: TMLPlace) {
        self.init(name: place.name, street: place.street, area: place.area, city: place.city)
    }

    /// What an Approximate share may say: the area and the city, never the name or the street.
    /// Nil when it has neither.
    public var approximate: PlaceParts? { PlaceParts(area: area, city: city) }

    public var hasNameOrStreet: Bool { name != nil || street != nil }

    /// The session's `place` for these parts, describing the fix recorded at `at`.
    public func place(at: Date) -> TMLPlace {
        TMLPlace(name: name, street: street, area: area, city: city, at: at)
    }
}

/// One part of a place, as the rules hold it (shared PlacePart, `TMLSchemaConstants.placePartMaxLength`).
public enum PlacePart {
    public static var maxLength: Int { TMLSchemaConstants.placePartMaxLength }

    /// A geocoder's text, made fit for the session: control characters (Cc) and the bidi
    /// overrides and isolates removed, Unicode whitespace trimmed, and cut at a character boundary
    /// to at most 80 UTF-16 code units, so no grapheme or surrogate pair is split. Nil when
    /// nothing is left.
    public static func clean(_ text: String?) -> String? {
        guard let text else { return nil }
        var kept = String.UnicodeScalarView()
        kept.append(contentsOf: text.unicodeScalars.filter { !isRefused($0) })
        let trimmed = String(kept).trimmingCharacters(in: .whitespacesAndNewlines)
        var cut = ""
        var units = 0
        for character in trimmed {
            let size = character.utf16.count
            if units + size > maxLength { break }
            cut.append(character)
            units += size
        }
        // A cut can end on a space.
        let part = cut.trimmingCharacters(in: .whitespacesAndNewlines)
        return part.isEmpty ? nil : part
    }

    /// What the rules refuse anywhere in a part: control characters (Cc), and the bidi overrides
    /// and isolates U+202A to U+202E and U+2066 to U+2069 (matched by value).
    public static func isRefused(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.generalCategory == .control
            || (0x202A...0x202E).contains(scalar.value)
            || (0x2066...0x2069).contains(scalar.value)
    }

    /// Whether firestore.rules take a stored part: null, or 1 to 80 UTF-16 code units (their
    /// `size()`) with nothing refused and no space at either end.
    public static func isValid(_ part: String?) -> Bool {
        guard let part else { return true }
        let units = part.utf16.count
        guard units >= 1, units <= maxLength, !part.unicodeScalars.contains(where: isRefused) else { return false }
        return part.unicodeScalars.first != " " && part.unicodeScalars.last != " "
    }
}

/// What a reverse geocoder says about a point: the placemark fields a place is made from
/// (`CLPlacemark`'s names), so the mapping can be tested without Core Location.
public struct GeocodedAddress: Hashable, Sendable {
    public var name: String?
    public var areasOfInterest: [String]
    public var thoroughfare: String?
    public var subThoroughfare: String?
    public var subLocality: String?
    public var locality: String?
    public var subAdministrativeArea: String?
    public var administrativeArea: String?
    public var postalCode: String?
    public var country: String?

    public init(name: String? = nil, areasOfInterest: [String] = [], thoroughfare: String? = nil,
                subThoroughfare: String? = nil, subLocality: String? = nil, locality: String? = nil,
                subAdministrativeArea: String? = nil, administrativeArea: String? = nil, postalCode: String? = nil,
                country: String? = nil) {
        self.name = name
        self.areasOfInterest = areasOfInterest
        self.thoroughfare = thoroughfare
        self.subThoroughfare = subThoroughfare
        self.subLocality = subLocality
        self.locality = locality
        self.subAdministrativeArea = subAdministrativeArea
        self.administrativeArea = administrativeArea
        self.postalCode = postalCode
        self.country = country
    }
}

extension PlaceParts {
    /// A geocoder's answer as a place: street = thoroughfare, area = subLocality, city = locality,
    /// and name = the first area of interest, or else the placemark's name when it names a place
    /// rather than an address (see `placeName`). Nil when nothing usable is left.
    public init?(_ geocoded: GeocodedAddress) {
        self.init(name: Self.placeName(geocoded), street: geocoded.thoroughfare, area: geocoded.subLocality,
                  city: geocoded.locality)
    }

    /// The name of a real place at the point, never a street address.
    ///
    /// - An area of interest ("Golden Gate Park", "Eiffel Tower") is one, unless it is just the
    ///   street (the viewer would say it twice).
    /// - The placemark's own name is one only when it isn't the address: it doesn't contain the
    ///   street ("2335 Folsom St", "23-9, Jinnan 1-Chome") or the house number, isn't the
    ///   neighbourhood, city, county, state, country or postcode, and isn't just numbers. A named
    ///   water ("San Francisco Bay") passes.
    static func placeName(_ geocoded: GeocodedAddress) -> String? {
        let street = PlacePart.clean(geocoded.thoroughfare)
        for interest in geocoded.areasOfInterest {
            if let name = PlacePart.clean(interest), !same(name, street) { return name }
        }
        guard let name = PlacePart.clean(geocoded.name) else { return nil }
        if let street, name.range(of: street, options: [.caseInsensitive, .diacriticInsensitive]) != nil { return nil }
        if let number = PlacePart.clean(geocoded.subThoroughfare), number.contains(where: \.isNumber),
           name.contains(number) { return nil }
        let areas = [geocoded.subLocality, geocoded.locality, geocoded.subAdministrativeArea,
                     geocoded.administrativeArea, geocoded.country, geocoded.postalCode]
        if areas.contains(where: { same(name, PlacePart.clean($0)) }) { return nil }
        if name.allSatisfy({ $0.isNumber || $0.isPunctuation || $0.isWhitespace || $0.isSymbol }) { return nil }
        return name
    }

    private static func same(_ a: String, _ b: String?) -> Bool {
        guard let b else { return false }
        return a.compare(b, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }
}

/// What a lookup found. The share treats `.nothing` and `.failed` alike: no place, so nothing is
/// written. They differ only in when it looks again: after `.nothing` once the phone has moved,
/// after `.failed` (an error, rate limiting, cancellation, or too slow) after a backoff.
public enum PlaceLookupResult: Hashable, Sendable {
    case found(PlaceParts)
    /// The geocoder answered, with nothing usable at that point.
    case nothing
    /// No answer: an error, rate limiting, cancellation, or no network.
    case failed
}

/// Reverse geocoding on the sharer's phone, for the session's `place` (x-decisions Q-PLACE).
/// `PingUploader` decides when to look up and what to write. Implementations: `LivePlaceLookup`
/// (MapKit), `FakePlaceLookup`.
@MainActor
public protocol PlaceLookup: AnyObject {
    /// The place at a point (WGS 84). Returns `.failed` promptly once its task is cancelled.
    func lookUp(latitude: Double, longitude: Double) async -> PlaceLookupResult
}

/// A change to the session's `place`, written in a ping's batch or with a precision change.
public enum PlaceUpdate: Hashable, Sendable {
    /// `place` = this: all five keys, null for an empty part.
    case set(TMLPlace)
    /// `place` = null.
    case clear

    /// The session's `place` after the write.
    public var place: TMLPlace? {
        switch self {
        case .set(let place): place
        case .clear: nil
        }
    }

    public var hasNameOrStreet: Bool { place.map { $0.name != nil || $0.street != nil } ?? false }
}

extension Date {
    /// The whole millisecond before this time. A place's `at` written again on its own uses it, so
    /// it is never later than `last_fix_at` as Firestore stored it (to the microsecond), whatever
    /// the rounding between `Date` and `Timestamp`.
    var wholeMillisecondBefore: Date {
        Date(timeIntervalSince1970: ((timeIntervalSince1970 * 1000).rounded(.down) - 1) / 1000)
    }
}
