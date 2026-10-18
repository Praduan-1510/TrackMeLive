import Foundation
import Testing
@testable import TMLCore

@Suite("People on screen")
struct PersonPresentationTests {
    let now = Date(timeIntervalSince1970: 1_792_300_680)
    let en = Locale(identifier: "en_US")
    let utc = TimeZone(identifier: "UTC") ?? .gmt

    @Test func theViewersInitialIsOnlyEverTheFirstLetter() {
        #expect(ViewerInitial.from("Mom") == "M")
        #expect(ViewerInitial.from("  éva ") == "É")
        #expect(ViewerInitial.from("   ") == nil)
        #expect(ViewerInitial.from(nil) == nil)
        #expect(ViewerInitial.from("\u{1F600} Sam") == nil) // a person icon, never an emoji disc
    }

    @Test func agoReadsShortOnScreenAndLongForVoiceOver() {
        #expect(TimeText.agoShort(now.addingTimeInterval(-2), now: now) == "2 s ago")
        #expect(TimeText.agoShort(now, now: now) == "1 s ago")
        #expect(TimeText.agoShort(now.addingTimeInterval(-150), now: now) == "3 min ago")
        #expect(TimeText.agoSpoken(now.addingTimeInterval(-2), now: now, locale: en) == "2 seconds ago")
        #expect(TimeText.agoSpoken(now.addingTimeInterval(-150), now: now, locale: en) == "3 minutes ago")
    }

    @Test func lastSeenUsesTheDevicesTimeFormat() {
        let at = Date(timeIntervalSince1970: 1_792_300_680) // 05:18 UTC
        #expect(TimeText.lastSeen(at, locale: en, timeZone: utc) == "Last seen 5:18\u{202F}AM")
        #expect(TimeText.lastSeen(at, locale: Locale(identifier: "en_GB"), timeZone: utc) == "Last seen 5:18")
        let evening = at.addingTimeInterval(16 * 3600)
        #expect(TimeText.lastSeen(evening, locale: Locale(identifier: "de_DE"), timeZone: utc) == "Last seen 21:18")
    }

    /// One phrase per marker, as the design system writes it.
    @Test func aMarkerReadsAsOnePhrase() {
        let distance = DistanceText(meters: 1_234, units: .metric, locale: en)
        let live = PersonSpeech.marker(name: "Alex", role: .sharer, state: .live, distance: distance,
                                       updatedAt: now.addingTimeInterval(-2), now: now, locale: en)
        #expect(live == "Alex, live, 1.2 kilometers away, updated 2 seconds ago")
        let viewer = PersonSpeech.marker(name: "Mom", role: .viewer, state: .live, distance: nil,
                                         updatedAt: now.addingTimeInterval(-3), now: now, locale: en)
        #expect(viewer == "Mom, sharing back, updated 3 seconds ago")
        let seen = PersonSpeech.marker(name: "Alex", role: .sharer, state: .lastSeen(now), distance: nil,
                                       updatedAt: now, now: now, locale: en)
        #expect(seen.hasPrefix("Alex, last seen "))
        #expect(!seen.contains("updated"))
        let approximate = PersonSpeech.marker(name: "Alex", role: .sharer, state: .approximate,
                                              distance: DistanceText(meters: 1_400, units: .metric, approximate: true, locale: en),
                                              updatedAt: nil, now: now, locale: en)
        #expect(approximate == "Alex, live, approximate location, about 1.5 kilometers away")
    }

    @Test func aRowReadsAsOnePhrase() {
        #expect(PersonSpeech.phrase(name: "Mom", status: "Live", details: ["sharing back", "updated 3 seconds ago"])
            == "Mom, live, sharing back, updated 3 seconds ago")
        #expect(PersonSpeech.phrase(name: "Them", status: "Waiting", details: ["Link sent · not opened yet", ""])
            == "Them, waiting, Link sent · not opened yet")
    }
}
