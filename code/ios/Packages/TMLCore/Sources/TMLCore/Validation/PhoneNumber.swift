import Foundation

/// A mobile number, ready for Firebase Auth in E.164 (FSD §8: only Firebase Authentication holds it).
public struct PhoneNumber: Hashable, Sendable {
    /// ISO region code of the country it was entered for, e.g. "US".
    public let regionCode: String
    /// The country calling code without "+", e.g. "1".
    public let callingCode: String
    /// The national significant number: digits only, no trunk prefix.
    public let nationalNumber: String

    public init(regionCode: String, callingCode: String, nationalNumber: String) {
        self.regionCode = regionCode
        self.callingCode = callingCode
        self.nationalNumber = nationalNumber
    }

    /// "+14155550142"
    public var e164: String { "+\(callingCode)\(nationalNumber)" }

    /// How the code screen shows it: "+1 (415) 555-0142" for the North American plan, otherwise the
    /// calling code and the national number, "+44 7400123456".
    public var displayString: String {
        if callingCode == "1", nationalNumber.count == 10 {
            let digits = Array(nationalNumber)
            return "+1 (\(String(digits[0..<3]))) \(String(digits[3..<6]))-\(String(digits[6..<10]))"
        }
        return "+\(callingCode) \(nationalNumber)"
    }
}

/// Reads what someone typed, pasted or autofilled into the number field.
public enum PhoneNumberInput {
    public enum Problem: Error, Hashable, Sendable {
        /// No digits yet.
        case empty
        /// Too short, too long, or not a mobile number for the region.
        case invalid
    }

    /// A field this long holds any real number with its formatting, so typing stops there.
    public static let maxTypedLength = 24

    /// What the field keeps while typing: digits (any script's, as ASCII), "+", spaces and the usual
    /// separators. Anything else is dropped, and typing stops at `maxTypedLength`.
    public static func limitTyping(_ text: String) -> String {
        var kept = ""
        for character in text {
            if let digit = asciiDigit(character) {
                kept.append(digit)
            } else if "+ -().".contains(character) {
                kept.append(character)
            }
            if kept.count == maxTypedLength { break }
        }
        return kept
    }

    /// The region a pasted or autofilled "+…" number belongs to, so the picker can follow it.
    /// Nil when the text doesn't start with "+" or its calling code is unknown.
    public static func region(of text: String, preferred: PhoneRegion) -> PhoneRegion? {
        guard isInternational(text) else { return nil }
        return PhoneRegion.region(forInternationalDigits: Substring(digits(in: text)), preferred: preferred)
    }

    /// The number for `region`, or why it can't be used. A number starting with "+" carries its own
    /// calling code, which wins over the region.
    public static func parse(_ text: String, region: PhoneRegion) -> Result<PhoneNumber, Problem> {
        let allDigits = digits(in: text)
        guard !allDigits.isEmpty else { return .failure(.empty) }

        var region = region
        var national = Substring(allDigits)
        if isInternational(text) {
            guard let match = PhoneRegion.region(forInternationalDigits: national, preferred: region) else {
                return .failure(.invalid)
            }
            region = match
            national = national.dropFirst(match.callingCode.count)
        } else {
            national = stripPrefixes(national, region: region)
        }

        let number = String(national)
        guard isValid(number, region: region) else { return .failure(.invalid) }
        return .success(PhoneNumber(regionCode: region.code, callingCode: region.callingCode, nationalNumber: number))
    }

    // MARK: - Helpers

    private static func isInternational(_ text: String) -> Bool {
        text.drop(while: { $0.isWhitespace }).first == "+"
    }

    private static func digits(in text: String) -> String {
        String(text.compactMap(asciiDigit))
    }

    /// "٤" and "4" both read as 4: phone keypads in some scripts type their own digits.
    private static func asciiDigit(_ character: Character) -> Character? {
        guard let value = character.wholeNumberValue, (0...9).contains(value), character.isNumber else { return nil }
        return Character(String(value))
    }

    /// The prefixes people type before a national number: the trunk prefix ("07400…" in the UK),
    /// or the 1 of "1 415 555 0142" in the North American plan.
    private static func stripPrefixes(_ national: Substring, region: PhoneRegion) -> Substring {
        if region.rule == .nanp {
            return national.count == 11 && national.first == "1" ? national.dropFirst() : national
        }
        if let trunk = region.trunkPrefix, national.hasPrefix(trunk), national.count > trunk.count + 3 {
            return national.dropFirst(trunk.count)
        }
        return national
    }

    private static func isValid(_ national: String, region: PhoneRegion) -> Bool {
        // E.164: at most 15 digits with the calling code. Nothing real is shorter than 4.
        guard (4...14).contains(national.count), region.callingCode.count + national.count <= 15 else { return false }
        switch region.rule {
        case .nanp:
            // NXX-NXX-XXXX: neither the area code nor the exchange starts with 0 or 1.
            let digits = Array(national)
            return digits.count == 10 && !"01".contains(digits[0]) && !"01".contains(digits[3])
        case let .mobile(lengths, prefixes):
            return lengths.contains(national.count) && prefixes.contains(where: { national.hasPrefix($0) })
        case nil:
            return region.callingCode.count + national.count >= 8
        }
    }
}
