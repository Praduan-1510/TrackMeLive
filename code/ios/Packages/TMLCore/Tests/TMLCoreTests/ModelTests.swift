import Foundation
import Testing
@testable import TMLCore

@Suite("Share Live Activity")
struct ShareActivityTests {
    let start = Date(timeIntervalSince1970: 1_792_300_680) // a Saturday evening
    var attributes: ShareActivityAttributes {
        ShareActivityAttributes(sessionID: "s1", mascot: .fox, viewerName: "  Mom ",
                                startedAt: start, expiresAt: start.addingTimeInterval(3600))
    }

    @Test func roundTripsAsJSON() throws {
        let state = ShareActivityAttributes.ContentState(signal: .noSignal, lastPingAt: start, viewerSharing: true, distanceMeters: 1_234)
        let data = try JSONEncoder().encode(state)
        #expect(try JSONDecoder().decode(ShareActivityAttributes.ContentState.self, from: data) == state)
        let attrData = try JSONEncoder().encode(attributes)
        #expect(try JSONDecoder().decode(ShareActivityAttributes.self, from: attrData) == attributes)
    }

    @Test func namesTheViewerOnlyWhenGivenAndNeverGuessesAPronoun() {
        var a = attributes
        let opened = ShareActivityAttributes.ContentState(lastPingAt: start, viewerOpenedAt: start)
        let notOpened = ShareActivityAttributes.ContentState(lastPingAt: start)
        #expect(a.sharingWithLine == "Sharing with Mom")
        #expect(a.viewerStatusLine(notOpened) == "Link sent · not opened yet")
        #expect(a.viewerStatusLine(opened) == "Mom is watching")
        a.viewerName = "   "
        #expect(a.sharingWithLine == "Sharing your location")
        #expect(a.viewerStatusLine(opened) == "They\u{2019}re watching")
    }

    /// The attributes snapshot the session document's sharer (shared schema), so a share keeps
    /// the mascot it started with; a timer never runs past the 1-hour limit.
    @Test func buildFromTheSharedSessionDocument() {
        let session = TMLShareSession(
            status: .active, startedAt: start, expiresAt: start.addingTimeInterval(3600),
            stopRule: .minutes, stopMinutes: .minutes30, stopAt: start.addingTimeInterval(30 * 60), callActive: true,
            shareBackAllowed: true, lastPingAt: start, pingIntervalS: 3.5, precision: .precise,
            sharer: TMLSharerSnapshot(name: "Alex", mascotId: .neko, mascotColor: .dusk, mascotAccessory: .glasses),
            viewerSharing: false)
        let a = ShareActivityAttributes(sessionID: "s2", session: session, viewerName: nil)
        #expect(a.mascot == .neko && a.mascotColor == .dusk && a.mascotAccessory == .glasses)
        #expect(a.expiresAt == session.expiresAt)
        #expect(a.sharingWithLine == "Sharing your location")
        let late = ShareActivityAttributes.ContentState(lastPingAt: start, stopsAt: start.addingTimeInterval(90 * 60))
        #expect(a.stopsAt(late) == a.expiresAt)
        #expect(a.stopsAt(.init(lastPingAt: start)) == nil)
        #expect(TMLShareSession.Field.callActive.rawValue == "call_active")
    }

    @Test func limitWarningShowsInTheLastFiveMinutesOnly() {
        let a = attributes
        #expect(!a.showsLimitWarning(at: start.addingTimeInterval(54 * 60)))
        #expect(a.showsLimitWarning(at: start.addingTimeInterval(55 * 60)))
        #expect(!a.showsLimitWarning(at: start.addingTimeInterval(60 * 60)))
    }
}

@Suite("Settings")
struct SettingsTests {
    @Test func defaultsMatchTheFSD() {
        let d = TMLUserSettings.defaults
        #expect(d.offerOnCall && d.shareBack && d.alertLinkOpened && d.alertCallEnded && d.alertExpiry)
        #expect(d.precision == .precise)
        #expect(d.defaultStop == .call)
    }

    @Test func defaultStopMapsToTheSessionStopRule() {
        #expect(TMLDefaultStop.call.stopRule.rule == .call && TMLDefaultStop.call.stopRule.minutes == nil)
        #expect(TMLDefaultStop.minutes30.stopRule.rule == .minutes && TMLDefaultStop.minutes30.stopRule.minutes == .minutes30)
        #expect(TMLDefaultStop.allCases.map(\.label) == ["When the call ends", "In 15 min", "In 30 min", "In 1 hour"])
    }

    @Test func settingsRoundTripWithFirestoreFieldNames() throws {
        var s = TMLUserSettings.defaults
        s.defaultStop = .minutes15
        let data = try JSONEncoder().encode(s)
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["default_stop"] as? Int == 15)
        #expect(json["alert_link_opened"] as? Bool == true)
        #expect(try JSONDecoder().decode(TMLUserSettings.self, from: data) == s)
    }
}

@Suite("Deep links")
struct RouteTests {
    @Test(arguments: TMLCore.Route.allCases)
    func roundTrips(route: TMLCore.Route) {
        #expect(TMLCore.Route(url: route.url) == route)
    }

    @Test func ignoresOtherSchemes() throws {
        #expect(TMLCore.Route(url: try #require(URL(string: "https://share"))) == nil)
        #expect(TMLCore.Route(url: try #require(URL(string: "trackmelive://nope"))) == nil)
    }
}
