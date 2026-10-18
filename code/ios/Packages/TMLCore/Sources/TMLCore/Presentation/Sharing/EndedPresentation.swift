import Foundation

/// The screen after a share ends, for each end reason (FSD §4 Auto-expiry, Stop sharing; prototype
/// `viewEnded`, `endedWhy`, `deletedBy`). The heading and the reason's line come from
/// `ShareEndReason`; this adds the summary and the deletion line.
public struct EndedPresentation: Equatable, Sendable {
    public struct SummaryRow: Equatable, Sendable, Identifiable {
        public let label: String
        public let value: String
        public var id: String { label }
    }

    public let reason: ShareEndReason
    /// "Sharing stopped after 1 hour" at the limit, otherwise "Sharing ended".
    public let title: String
    /// Why it ended, in one line.
    public let message: String
    public let summary: [SummaryRow]
    /// "Location points from this session are deleted by 9:52 pm tomorrow."
    public let deletion: String
    /// At the limit, Share again (a new session with a new link) leads, and Done follows.
    public let offersShareAgain: Bool

    public init(ended: EndedShare, locale: Locale = .current, timeZone: TimeZone = .current) {
        let clock = { (date: Date) in TimeText.clock(date, locale: locale, timeZone: timeZone) }
        let audience = ShareAudience(ended.viewerName)
        reason = ended.reason
        title = ended.reason.title
        message = ended.reason.message(endedTime: clock(ended.endedAt))

        var rows: [SummaryRow] = []
        if let name = audience.name {
            rows.append(SummaryRow(label: "Shared with", value: name))
        }
        rows.append(SummaryRow(label: "Shared for", value: DurationText.short(ended.duration)))
        rows.append(SummaryRow(label: audience.name.map { "\(PersonName.isolated($0)) opened it" } ?? "Link opened",
                               value: ended.firstViewedAt.map(clock) ?? "Not opened"))
        if ShareFeatures.liveTogether {
            rows.append(SummaryRow(label: audience.name.map { "\(PersonName.isolated($0)) shared back" } ?? "Shared back",
                                   value: ended.sharedBack ? "Yes" : "No"))
        }
        summary = rows

        // The points go 24 hours after the end; the session's details stay 30 days (FSD §8 Retention).
        deletion = "Location points from this session are deleted by \(clock(ended.pointsDeletedBy)) tomorrow."
        offersShareAgain = ended.reason.offersShareAgain
    }
}
