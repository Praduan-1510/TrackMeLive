import Foundation
import Testing
@testable import TMLCore

@Suite("Distances as the design system writes them")
struct DistanceTextTests {
    let us = Locale(identifier: "en_US")
    let uk = Locale(identifier: "en_GB")

    @Test(arguments: [
        (338.0, "340 m"), (4.0, "0 m"), (994.0, "990 m"), (996.0, "1.0 km"),
        (1_234.0, "1.2 km"), (9_940.0, "9.9 km"), (9_960.0, "10 km"), (12_400.0, "12 km"),
    ])
    func kilometers(meters: Double, expected: String) {
        // Rounding never leaves "1000 m" or "10.0 km": it moves up to the next unit or precision.
        #expect(DistanceText(meters: meters, units: .metric, locale: us).short == expected)
    }

    @Test(arguments: [
        (91.44, "300 ft"), (643.7, "0.4 mi"), (4_023.4, "2.5 mi"), (19_312.1, "12 mi"),
    ])
    func miles(meters: Double, expected: String) {
        #expect(DistanceText(meters: meters, units: .imperial, locale: us).short == expected)
    }

    @Test(arguments: [
        (300.0, "under 1 km"), (700.0, "under 1 km"), (1_200.0, "about 1 km"),
        (1_300.0, "about 1.5 km"), (2_000.0, "about 2 km"),
    ])
    func approximateRoundsToHalfKilometers(meters: Double, expected: String) {
        #expect(DistanceText(meters: meters, units: .metric, approximate: true, locale: us).short == expected)
    }

    @Test func spokenUsesTheLongUnit() {
        #expect(DistanceText(meters: 1_234, units: .metric, locale: us).spoken == "1.2 kilometers")
        #expect(DistanceText(meters: 1_300, units: .metric, approximate: true, locale: us).spoken == "about 1.5 kilometers")
        #expect(DistanceText(meters: 4_023.4, units: .imperial, locale: us).spoken == "2.5 miles")
    }

    @Test func unitsFollowTheLocale() {
        #expect(DistanceText.Units(locale: us) == .imperial)
        #expect(DistanceText.Units(locale: Locale(identifier: "fr_FR")) == .metric)
        _ = uk
    }
}
