import Foundation

/// "Who it's for" (FSD §4): the optional name of the person getting the link, used only on the
/// sharer's own screens. Without a name the copy says they and them and the viewer's disc shows a
/// person icon. The copy never guesses a pronoun from a name (prototype `who`).
public struct ShareAudience: Hashable, Sendable {
    /// The tidied name, or nil when none was given.
    public let name: String?

    public init(_ raw: String?) {
        let tidy = PersonName.tidy(raw ?? "")
        name = tidy.isEmpty ? nil : tidy
    }

    /// The name direction-isolated for a sentence, so a right-to-left name never reorders it.
    private var inSentence: String? { name.map(PersonName.isolated) }

    /// "Mom" or "They", to start a sentence.
    public var they: String { inSentence ?? "They" }
    /// "Mom" or "them", inside a sentence.
    public var them: String { inSentence ?? "them" }
    /// The viewer's row: "Mom" or "Them".
    public var label: String { name ?? "Them" }
    /// The viewer's disc: the first letter or digit of the name, or nil for a person icon.
    public var initial: String? { ViewerInitial.from(name) }

    /// "Mom sees" / "They see".
    var sees: String { inSentence.map { "\($0) sees" } ?? "They see" }
    /// "Mom will" / "They\u{2019}ll".
    var will: String { inSentence.map { "\($0) will" } ?? "They\u{2019}ll" }
    /// "is" for a name, "are" for they.
    var isOrAre: String { name == nil ? "are" : "is" }
}
