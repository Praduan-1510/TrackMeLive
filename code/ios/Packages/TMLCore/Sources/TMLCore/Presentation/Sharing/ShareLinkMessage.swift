import Foundation

/// What the system share sheet carries (FSD §4 Live map link; prototype `sharesheet` and the message
/// Mom receives): a line of text and the link, with a preview header of the sharer's name and
/// "Live location". The app never sends anything itself; the person picks Messages, WhatsApp,
/// Mail or Copy link.
public struct ShareLinkMessage: Hashable, Sendable {
    public let url: URL
    /// "I'm sharing my live location with you." (" while we talk" during a call).
    public let text: String
    /// The share sheet's header: "Alex · Live location".
    public let previewTitle: String

    public init(url: URL, sharerName: String, duringCall: Bool) {
        self.url = url
        text = "I\u{2019}m sharing my live location with you\(duringCall ? " while we talk" : "")."
        previewTitle = "\(PersonName.isolated(PersonName.tidy(sharerName))) \u{00B7} Live location"
    }
}

/// How the share sheet closed (FSD §4 Live map link).
public enum ShareSheetOutcome: Hashable, Sendable {
    /// The link went somewhere: Messages, Mail, another app, or Copy link (copying counts as sent).
    case sent(copied: Bool)
    /// It closed without a choice, or the chosen app was cancelled: nobody got the link.
    case cancelled
}
