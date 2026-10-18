import Foundation

/// Features that arrive in a later sprint, as seams that default to off. Sprint 2's shares are all
/// manual: no call state, no "When the call ends", no share back, so the screens don't show them.
public enum ShareFeatures {
    /// Live Together: the call, share back, Ask to share and the viewer's distance (Sprint 3).
    public static let liveTogether = false
}

/// Everything the live screen says, worked out from the share and the clock, so the view only lays
/// it out (prototype `viewLive`, `liveSub`, `tilesHtml`, `momState`, `precisionRow`). Pure: the
/// same inputs give the same words, which is what the tests check.
public struct LivePresentation: Equatable, Sendable {
    public struct Badge: Equatable, Sendable {
        public enum Tone: Equatable, Sendable { case live, quiet }
        /// In sentence case; the badge style uppercases it.
        public let title: String
        public let spoken: String
        public let tone: Tone
    }

    public struct Tile: Equatable, Sendable {
        public let value: String
        public let label: String
        public let spoken: String
        /// Values that tick use tabular figures.
        public let ticking: Bool
    }

    public struct Row: Equatable, Sendable {
        public let name: String
        public let detail: String
        public let spokenDetail: String
        public let status: String
        public let tone: StatusTone
        /// A viewer who hasn't opened the link yet, or a sharer without fresh points.
        public let isQuiet: Bool
    }

    public struct Bar: Equatable, Sendable {
        /// "On a call" during the session's own call, otherwise "Sharing live".
        public let title: String
        /// "Stops at 9:52 pm", or the call's running time.
        public let subtitle: String
        public let isCall: Bool
    }

    public struct PrecisionControl: Equatable, Sendable {
        /// What the segmented control shows: a pending change, or what pings use now.
        public let shown: TMLPrecision
        /// "From the next update", "Precise is off in Settings", "Within about 500 m", "Your exact spot".
        public let note: String
        /// False when iOS gives the app only approximate locations.
        public let canChoosePrecise: Bool
    }

    /// "Sharing live", or "Live Together" while the viewer shares back.
    public let title: String
    public let badge: Badge
    /// The line under the title: who has opened the link, or why points aren't getting out.
    public let subtitle: String
    /// "Sharing stops at 10:38 pm · 1-hour limit", from 5 minutes before the limit.
    public let limitWarning: String?
    public let distance: Tile
    public let duration: Tile
    public let stops: Tile
    public let you: Row
    public let viewer: Row
    /// The viewer's disc: the name's initial, or nil for a person icon.
    public let viewerInitial: String?
    /// Why share back isn't on offer, in one line under the viewer's row.
    public let shareBackNote: String?
    public let precision: PrecisionControl
    public let bar: Bar
    /// The Stop sharing confirmation's message.
    public let stopMessage: String

    /// - Parameters:
    ///   - now: the server's time (`share.clock.server(Date())`).
    ///   - preciseAllowed: iOS gives the app precise locations.
    ///   - viewerDistance: the straight-line distance, once the viewer shares back.
    ///   - callStartedAt: when the call connected, for the bar's running time.
    ///   - liveTogether: the Sprint 3 seam (`ShareFeatures.liveTogether`).
    public init(share: LiveShare, now: Date, preciseAllowed: Bool = true, viewerDistance: DistanceText? = nil,
                callStartedAt: Date? = nil, liveTogether: Bool = ShareFeatures.liveTogether,
                locale: Locale = .current, timeZone: TimeZone = .current) {
        let clock = { (date: Date) in TimeText.clock(date, locale: locale, timeZone: timeZone) }
        let audience = ShareAudience(share.viewerName)
        let countdown = share.countdown
        let callActive = liveTogether && share.callChoiceAvailable
        let viewerSharing = liveTogether && share.viewerSharing
        let shareBackPossible = callActive && share.shareBackAllowed
        let approximate = share.precision == .approximate

        title = viewerSharing ? "Live Together" : "Sharing live"

        switch share.upload {
        case .offline: badge = Badge(title: "No connection", spoken: "No connection", tone: .quiet)
        case .noSignal: badge = Badge(title: "No signal", spoken: "No GPS signal", tone: .quiet)
        case .live, .waitingForFix: badge = Badge(title: "Live", spoken: "Sharing live", tone: .live)
        }

        let opened = share.firstViewedAt
        let seesLast = opened != nil
            ? "\(audience.sees) where you were last seen."
            : "\(audience.will) see where you were last seen when they open the link."
        switch share.upload {
        case .offline:
            subtitle = "No connection right now. \(seesLast)"
        case .noSignal:
            subtitle = "No GPS signal right now. \(seesLast)"
        case .live, .waitingForFix:
            if let opened {
                let at = "\(audience.they) opened your link at \(clock(opened))"
                if viewerSharing {
                    subtitle = "\(at) and \(audience.isOrAre) sharing back."
                } else {
                    subtitle = "\(at).\(shareBackPossible ? " Share back is on." : "")"
                }
            } else if audience.name != nil {
                subtitle = "Link sent to \(audience.them). You\u{2019}ll know when it\u{2019}s opened."
            } else {
                subtitle = "Link sent. You\u{2019}ll know when it\u{2019}s opened."
            }
        }

        limitWarning = countdown.showsLimitWarning(at: now)
            ? "Sharing stops at \(clock(share.expiresAt)) \u{00B7} 1-hour limit"
            : nil

        if viewerSharing, let viewerDistance {
            distance = Tile(value: viewerDistance.short, label: "apart", spoken: "Distance, \(viewerDistance.spoken)",
                            ticking: false)
        } else if shareBackPossible {
            distance = Tile(value: "Waiting", label: "for \(audience.them) to share",
                            spoken: "Waiting for \(audience.them) to share", ticking: false)
        } else {
            distance = Tile(value: "\u{2014}", label: "not shared", spoken: "Distance not shared", ticking: false)
        }

        let elapsed = now.timeIntervalSince(share.startedAt)
        duration = Tile(value: DurationText.short(elapsed), label: "sharing",
                        spoken: "Sharing for \(DurationText.spoken(elapsed))", ticking: true)

        if share.stopRule == .call {
            stops = Tile(value: "When call ends", label: "stops", spoken: "Stops when the call ends", ticking: false)
        } else {
            // A no-break space keeps "9:52 pm" on one line in a narrow tile.
            stops = Tile(value: clock(countdown.endsAt).replacingOccurrences(of: " ", with: "\u{00A0}"), label: "stops",
                         spoken: "Stops at \(clock(countdown.endsAt))", ticking: false)
        }

        let precisionWord = approximate ? "Approximate" : "Precise"
        let interval = IntervalText.seconds(share.pingInterval, locale: locale)
        switch share.upload {
        case .offline:
            you = Row(name: "You", detail: "No connection", spokenDetail: "No connection", status: "Last seen",
                      tone: .quiet, isQuiet: true)
        case .noSignal:
            you = Row(name: "You", detail: "No GPS signal", spokenDetail: "No GPS signal", status: "Last seen",
                      tone: .quiet, isQuiet: true)
        case .live, .waitingForFix:
            you = Row(name: "You", detail: "\(precisionWord) \u{00B7} every \(interval.short)",
                      spokenDetail: "\(precisionWord), updates every \(interval.spoken)", status: "Live",
                      tone: .sharer, isQuiet: false)
        }

        if viewerSharing {
            viewer = Row(name: audience.label, detail: "Sharing back \u{00B7} updated just now",
                         spokenDetail: "Sharing back, updated now", status: "Live", tone: .viewer, isQuiet: false)
        } else if let opened {
            let asked = liveTogether ? share.shareBackRequestedAt : nil
            let at = asked.map { "Asked at \(clock($0))" } ?? "Opened at \(clock(opened))"
            viewer = Row(name: audience.label, detail: at, spokenDetail: at, status: "Watching", tone: .quiet,
                         isQuiet: false)
        } else {
            viewer = Row(name: audience.label, detail: "Link sent \u{00B7} not opened yet",
                         spokenDetail: "Link sent, not opened yet", status: "Waiting", tone: .quiet, isQuiet: true)
        }
        viewerInitial = audience.initial

        if !liveTogether || viewerSharing || shareBackPossible {
            shareBackNote = nil
        } else if share.callId == nil {
            shareBackNote = "\(audience.they) can share back only when you start sharing during a call."
        } else if !callActive {
            shareBackNote = "Share back ended with the call."
        } else {
            shareBackNote = "Share back is off for this call."
        }

        let pending = share.precisionNext.flatMap { $0 == share.precision ? nil : $0 }
        let note: String
        if pending != nil {
            note = "From the next update"
        } else if !preciseAllowed {
            note = "Precise is off in Settings"
        } else {
            note = approximate ? "Within about 500 m" : "Your exact spot"
        }
        precision = PrecisionControl(shown: pending ?? share.precision, note: note, canChoosePrecise: preciseAllowed)

        if callActive {
            bar = Bar(title: "On a call",
                      subtitle: callStartedAt.map { DurationText.callClock(now.timeIntervalSince($0)) } ?? "",
                      isCall: true)
        } else {
            bar = Bar(title: "Sharing live", subtitle: "Stops at \(clock(countdown.endsAt))", isCall: false)
        }

        stopMessage = opened != nil ? "\(audience.will) see that sharing ended." : "Your link will stop working."
    }
}

/// How long something has run, as the tiles and the ended screen write it (prototype `minutes`,
/// `minutesSpoken`, `mmss`).
public enum DurationText {
    /// "< 1 min", "4 min".
    public static func short(_ interval: TimeInterval) -> String {
        let minutes = Int(max(0, interval) / 60)
        return minutes < 1 ? "< 1 min" : "\(minutes) min"
    }

    /// "less than a minute", "1 minute", "4 minutes".
    public static func spoken(_ interval: TimeInterval) -> String {
        let minutes = Int(max(0, interval) / 60)
        switch minutes {
        case 0: return "less than a minute"
        case 1: return "1 minute"
        default: return "\(minutes) minutes"
        }
    }

    /// A call's running time: "04:12".
    public static func callClock(_ interval: TimeInterval) -> String {
        let seconds = Int(max(0, interval))
        let minutes = seconds / 60
        let rest = seconds % 60
        return (minutes < 10 ? "0" : "") + "\(minutes):" + (rest < 10 ? "0" : "") + "\(rest)"
    }
}

/// The real ping interval on the sharer's row: "3.5 s" / "3.5 seconds", "15 s" / "15 seconds".
public enum IntervalText {
    public static func seconds(_ value: Double, locale: Locale = .current) -> (short: String, spoken: String) {
        let rounded = (max(0, value) * 10).rounded() / 10
        let digits = rounded == rounded.rounded() ? 0 : 1
        let number = rounded.formatted(.number.precision(.fractionLength(digits)).locale(locale))
        return ("\(number) s", rounded == 1 ? "1 second" : "\(number) seconds")
    }
}
