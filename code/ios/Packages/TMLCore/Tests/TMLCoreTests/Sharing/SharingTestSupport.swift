import Foundation
@testable import TMLCore

/// Fixed times and formats for the sharing screens' tests: 9:38 pm UTC on Oct 17, 2026, in en_US.
enum ShareTime {
    static let start = Date(timeIntervalSince1970: 1_792_273_080) // 2026-10-17 21:38:00 UTC
    static let utc = TimeZone(identifier: "UTC")!
    static let locale = Locale(identifier: "en_US")

    /// `start` plus `minutes`.
    static func at(_ minutes: Double) -> Date { start.addingTimeInterval(minutes * 60) }

    /// The clock as the screens write it, in the tests' locale and zone.
    static func clock(_ date: Date) -> String { TimeText.clock(date, locale: locale, timeZone: utc) }
}

/// A name as it appears inside a sentence: direction-isolated.
func iso(_ name: String) -> String { PersonName.isolated(name) }

extension LiveShare {
    /// A live share that started at `ShareTime.start`, for the presentation tests.
    static func make(viewerName: String? = "Mom", stop: StopChoice = .minutes(.minutes30), precision: TMLPrecision = .precise,
                     precisionNext: TMLPrecision? = nil, firstViewedAt: Date? = nil, upload: UploadStatus = .live,
                     pingInterval: Double = 3.5, callId: String? = nil, callActive: Bool = false,
                     shareBackAllowed: Bool = false, viewerSharing: Bool = false,
                     shareBackRequestedAt: Date? = nil) -> LiveShare {
        let expiresAt = ShareTime.at(60)
        let change = ShareCountdown(expiresAt: expiresAt, stopRule: .call, stopAt: nil).change(to: stop, at: ShareTime.start)
        return LiveShare(
            sessionId: "s1", link: ShareLink(sessionId: "s1", url: URL(string: "https://trackme.live/s/8fK2")!),
            viewerName: viewerName, startedAt: ShareTime.start, expiresAt: expiresAt,
            stopRule: change.stopRule, stopMinutes: change.stopMinutes, stopAt: change.stopAt,
            precision: precision, precisionNext: precisionNext, callId: callId, callActive: callActive,
            shareBackAllowed: shareBackAllowed, firstViewedAt: firstViewedAt, viewerSharing: viewerSharing,
            shareBackRequestedAt: shareBackRequestedAt, pingInterval: pingInterval, upload: upload, clock: ServerClock()
        )
    }
}

extension LivePresentation {
    /// The presentation at `minutes` after the start, in the tests' locale and zone.
    static func at(_ minutes: Double, _ share: LiveShare, preciseAllowed: Bool = true, liveTogether: Bool = false,
                   viewerDistance: DistanceText? = nil, callStartedAt: Date? = nil) -> LivePresentation {
        LivePresentation(share: share, now: ShareTime.at(minutes), preciseAllowed: preciseAllowed,
                         viewerDistance: viewerDistance, callStartedAt: callStartedAt, liveTogether: liveTogether,
                         locale: ShareTime.locale, timeZone: ShareTime.utc)
    }
}

extension TMLUser {
    /// Alex, with Settings' sharing choices and the last "who it's for" name.
    static func sharer(lastViewerName: String? = "Mom", defaultStop: TMLDefaultStop = .call,
                       precision: TMLPrecision = .precise) -> TMLUser {
        var settings = TMLUserSettings.defaults
        settings.defaultStop = defaultStop
        settings.precision = precision
        return TMLUser(name: "Alex", mascotId: .fox, mascotColor: .original, lastViewerName: lastViewerName,
                       settings: settings, createdAt: ShareTime.start, updatedAt: ShareTime.start)
    }
}
