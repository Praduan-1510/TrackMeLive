import Foundation

/// Who a person is in a session. Lamplight always means the sharer, crossing the viewer.
public enum PersonRole: Hashable, Sendable {
    case sharer
    case viewer
}

/// Which color a status word and its mark take (StatusPill, PersonRow).
public enum StatusTone: Hashable, Sendable {
    /// The sharer is live: `lamplight-text` with a `lamplight` dot.
    case sharer
    /// The viewer is sharing back: `crossing-text` with a `crossing` dot.
    case viewer
    /// Waiting, Watching, Last seen, No signal, No connection, Reconnecting, Not sharing:
    /// `ink-secondary` with a hollow dot. Never alarming.
    case quiet
    /// Sharing ended: `ink` with a small square.
    case ended
    /// On a call: `connected` with a phone glyph. Call state only, never "success".
    case call
}

/// A marker's state on the map.
public enum MarkerState: Hashable, Sendable {
    case live
    /// The sharer's rounded point, drawn with the 1 km circle and no trail.
    case approximate
    /// No fresh location: a dashed ring, no halo, and "Last seen 9:41 pm".
    case lastSeen(Date)

    public var isLastSeen: Bool {
        if case .lastSeen = self { true } else { false }
    }
}

/// The initial on a viewer's disc: the first letter of the name the sharer gave, or nil (a person
/// icon) when there's no name. Nothing else is ever guessed from the name.
public enum ViewerInitial {
    public static func from(_ name: String?, locale: Locale = .current) -> String? {
        guard let first = name?.trimmingCharacters(in: .whitespacesAndNewlines).first,
              first.isLetter || first.isNumber else { return nil }
        return String(first).uppercased(with: locale)
    }
}

/// Times as the design system writes them. Short forms go on screen in tabular figures; VoiceOver
/// gets the long forms, built with the locale's formatters.
public enum TimeText {
    /// "2 s ago", "3 min ago".
    public static func agoShort(_ date: Date, now: Date) -> String {
        let seconds = max(1, Int((now.timeIntervalSince(date)).rounded()))
        return seconds < 60 ? "\(seconds) s ago" : "\(Int((Double(seconds) / 60).rounded())) min ago"
    }

    /// "2 seconds ago", "3 minutes ago".
    public static func agoSpoken(_ date: Date, now: Date, locale: Locale = .current) -> String {
        let seconds = max(1, Int((now.timeIntervalSince(date)).rounded()))
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.unitsStyle = .full
        formatter.dateTimeStyle = .numeric
        let value = seconds < 60 ? -Double(seconds) : -(Double(seconds) / 60).rounded() * 60
        return formatter.localizedString(fromTimeInterval: value)
    }

    /// The device's time format: "9:41 pm" (en_GB), "9:41 PM" (en_US), "21:41".
    public static func clock(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        var style = Date.FormatStyle(date: .omitted, time: .shortened)
        style.locale = locale
        style.timeZone = timeZone
        return date.formatted(style)
    }

    /// "Last seen 9:41 pm".
    public static func lastSeen(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        "Last seen \(clock(date, locale: locale, timeZone: timeZone))"
    }
}

/// The one phrase VoiceOver reads for a marker or a person row, so each is a single element:
/// "Alex, live, 1.2 kilometers away, updated 2 seconds ago".
public enum PersonSpeech {
    /// - Parameters:
    ///   - status: the status word as shown ("Live", "Sharing back", "Last seen 9:41 pm").
    ///   - details: further spoken parts, already in long form ("updated 3 seconds ago").
    public static func phrase(name: String, status: String?, distance: DistanceText? = nil, details: [String] = []) -> String {
        var parts = [name]
        if let status, !status.isEmpty { parts.append(lowercasingFirst(status)) }
        if let distance { parts.append("\(distance.spoken) away") }
        parts += details.filter { !$0.isEmpty }
        return parts.joined(separator: ", ")
    }

    /// A marker: name, state, distance, freshness.
    public static func marker(name: String, role: PersonRole, state: MarkerState, distance: DistanceText?,
                              updatedAt: Date?, now: Date, locale: Locale = .current) -> String {
        let status: String
        var details: [String] = []
        switch state {
        case .live:
            status = role == .sharer ? "Live" : "Sharing back"
        case .approximate:
            status = "Live, approximate location"
        case .lastSeen(let date):
            status = TimeText.lastSeen(date, locale: locale)
        }
        if !state.isLastSeen, let updatedAt {
            details.append("updated \(TimeText.agoSpoken(updatedAt, now: now, locale: locale))")
        }
        return phrase(name: name, status: status, distance: distance, details: details)
    }

    private static func lowercasingFirst(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.lowercased() + text.dropFirst()
    }
}
