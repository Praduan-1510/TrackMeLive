import Foundation

/// A person's name: the sign-up name, and later "Who it's for" (FSD §4; the shared schema's `PersonName`).
///
/// A name is 1–24 characters after tidying, and a character is a grapheme cluster: what a person sees
/// as one character, so a woman technologist emoji (four scalars joined by U+200D) or an "é" typed as
/// e plus a combining accent counts once. That is Swift's `String.count`, the same count as Android's
/// `BreakIterator` and the server's `Intl.Segmenter`, so the server never rejects a name the app let
/// someone type.
///
/// The characters follow the schema's pattern (x-decisions Q-NAME-CHARACTERS): no control characters
/// and no bidi overrides or isolates, which could reverse how a name displays to the viewer, and at
/// least one letter, number, symbol or emoji, so a name is never invisible.
public enum PersonName {
    /// Typing stops at 24 characters.
    public static let maxLength = TMLSchemaConstants.nameMaxLength

    public enum Problem: Error, Hashable, Sendable {
        /// Nothing left after tidying.
        case empty
        /// Over 24 characters. Typing stops at 24, so only a paste or a value from elsewhere gets here.
        case tooLong
        /// No letter, number, symbol or emoji (only punctuation or zero-width characters), or a control
        /// or bidi character, which typing drops but a value from elsewhere may hold.
        case needsLetterOrNumber
    }

    /// What the field keeps while someone types or pastes: tabs and line breaks become spaces (a name is
    /// one line), other control characters and bidi controls are dropped (they're invisible), and typing
    /// stops at 24 characters.
    public static func limitTyping(_ text: String) -> String {
        var kept = ""
        for character in text {
            if character.isNewline || (character.isWhitespace && character.unicodeScalars.contains(where: isRefused)) {
                kept.append(" ")
            } else if !character.unicodeScalars.contains(where: isRefused) {
                kept.append(character)
            }
            if kept.count == maxLength { break }
        }
        return kept
    }

    /// The name as it is saved: each run of whitespace becomes one space, and the ends are trimmed,
    /// like the prototype's `tidy()`. A zero-width no-break space counts as whitespace, as the server's
    /// JavaScript `trim()` treats it.
    public static func tidy(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace || $0 == "\u{FEFF}" }).joined(separator: " ")
    }

    /// The tidied name, or why it can't be used.
    public static func validate(_ text: String) -> Result<String, Problem> {
        let name = tidy(text)
        if name.isEmpty { return .failure(.empty) }
        if name.unicodeScalars.contains(where: isRefused) || !name.unicodeScalars.contains(where: isVisible) {
            return .failure(.needsLetterOrNumber)
        }
        if name.count > maxLength { return .failure(.tooLong) }
        return .success(name)
    }

    /// The name wrapped in FSI…PDI (U+2068…U+2069), so a right-to-left name never reorders the words
    /// around it: a greeting such as "Hi, " followed by an Arabic name stays a greeting followed by a
    /// name. Use it wherever a name is shown.
    public static func isolated(_ name: String) -> String {
        "\u{2068}\(name)\u{2069}"
    }

    /// Control characters (Cc) and the bidi overrides and isolates.
    private static func isRefused(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.generalCategory == .control
            || (0x202A...0x202E).contains(scalar.value)
            || (0x2066...0x2069).contains(scalar.value)
    }

    /// A letter, number, symbol or emoji: `\p{L}`, `\p{N}`, `\p{S}`.
    private static func isVisible(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber,
             .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol:
            true
        default:
            false
        }
    }
}
