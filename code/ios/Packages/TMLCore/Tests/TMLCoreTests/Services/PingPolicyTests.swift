import Foundation
import Testing
@testable import TMLCore

@Suite("Approximate rounding (FSD §4 Location detail)")
struct ApproximateLocationTests {
    private let cell = 500.0

    @Test func snapsToTheGridAndNeverStraysMoreThanHalfACellDiagonal() {
        for (lat, lng) in [(37.7849, -122.4021), (19.0760, 72.8777), (-33.8688, 151.2093), (51.5007, -0.1246), (0.0003, 0.0003)] {
            let rounded = ApproximateLocation.round(latitude: lat, longitude: lng)
            let offset = ApproximateLocation.meters(from: (lat, lng), to: (rounded.latitude, rounded.longitude))
            #expect(offset <= cell * 0.5 * 2.0.squareRoot() + 1, "\(lat), \(lng) moved \(offset) m")
            // The rounded point is a grid point: rounding it again changes nothing.
            let again = ApproximateLocation.round(latitude: rounded.latitude, longitude: rounded.longitude)
            #expect(abs(again.latitude - rounded.latitude) < 1e-9)
            #expect(abs(again.longitude - rounded.longitude) < 1e-9)
        }
    }

    @Test func pointsInTheSameCellGiveTheSamePoint() {
        // Around a cell's center, 20–30 m either way: well inside the 500 m cell.
        let center = ApproximateLocation.round(latitude: 37.7850, longitude: -122.4025)
        for (dLat, dLng) in [(0.0002, -0.0002), (-0.0002, 0.0003), (0.00025, 0.00025), (0, 0)] {
            let point = ApproximateLocation.round(latitude: center.latitude + dLat, longitude: center.longitude + dLng)
            #expect(point.latitude == center.latitude)
            #expect(point.longitude == center.longitude)
        }
    }

    @Test func walkingAcrossTheGridMovesInWholeRows() {
        var previous = ApproximateLocation.round(latitude: 37.78, longitude: -122.40)
        var rows = 0
        // 3 km north in 10 m steps: about 6 rows, each exactly one cell north. (Columns are laid out
        // per row, so the rounded longitude may shift too, always within half a cell of the walker.)
        for step in 1...300 {
            let lat = 37.78 + Double(step) * 10 / ApproximateLocation.metersPerDegree
            let next = ApproximateLocation.round(latitude: lat, longitude: -122.40)
            if next.latitude != previous.latitude {
                #expect(abs((next.latitude - previous.latitude) * ApproximateLocation.metersPerDegree - cell) < 0.001)
                rows += 1
            }
            #expect(ApproximateLocation.meters(from: (lat, -122.40), to: (next.latitude, next.longitude)) <= cell * 0.71)
            previous = next
        }
        #expect((5...7).contains(rows))
    }

    @Test func staysInRangeAtTheEdgesOfTheMap() {
        let dateLine = ApproximateLocation.round(latitude: 10, longitude: 179.9999)
        #expect((-180...180).contains(dateLine.longitude))
        let west = ApproximateLocation.round(latitude: 10, longitude: -179.9999)
        #expect((-180...180).contains(west.longitude))
        let pole = ApproximateLocation.round(latitude: 89.9999, longitude: 123.4)
        #expect(pole.latitude <= 90)
        #expect(pole.longitude == 0)
        let south = ApproximateLocation.round(latitude: -90, longitude: -45)
        #expect(south.latitude >= -90)
    }

    @Test func approximatePingsCarryAtLeast500MetersOfAccuracy() {
        let time = Date(timeIntervalSince1970: 1_000)
        let fix = LocationFix(latitude: 37.78512, longitude: -122.40233, horizontalAccuracy: 12, timestamp: time)
        let approx = ApproximateLocation.ping(for: fix, precision: .approximate, recordedAt: time)
        #expect(approx.accuracyM == 500)
        #expect(approx.lat != fix.latitude || approx.lng != fix.longitude)
        let rough = LocationFix(latitude: 37.78512, longitude: -122.40233, horizontalAccuracy: 850, timestamp: time)
        #expect(ApproximateLocation.ping(for: rough, precision: .approximate, recordedAt: time).accuracyM == 850)
    }

    @Test func precisePingsAreTheFixAsIs() {
        let time = Date(timeIntervalSince1970: 1_000)
        let fix = LocationFix(latitude: 37.78512, longitude: -122.40233, horizontalAccuracy: 12, timestamp: time)
        let ping = ApproximateLocation.ping(for: fix, precision: .precise, recordedAt: time.addingTimeInterval(3))
        #expect(ping == TMLPing(lat: 37.78512, lng: -122.40233, accuracyM: 12, recordedAt: time.addingTimeInterval(3)))
    }
}

@Suite("Ping cadence (FSD §4 Battery-aware pings, §7)")
struct PingCadenceTests {
    @Test func aboveTwentyPercentItIsThreeToFiveSecondsByMovement() {
        #expect(PingCadence.interval(batteryPercent: 21, motion: .fast, hasGoodFix: true) == 3)
        #expect(PingCadence.interval(batteryPercent: 80, motion: .moving, hasGoodFix: true) == 4)
        #expect(PingCadence.interval(batteryPercent: 100, motion: .still, hasGoodFix: true) == 5)
        // Without a fix worth showing, nothing is gained by pinging faster.
        #expect(PingCadence.interval(batteryPercent: 100, motion: .fast, hasGoodFix: false) == 5)
    }

    @Test func fromTwentyToTenPercentItIsFifteenSeconds() {
        for percent in [20, 15, 10] {
            #expect(PingCadence.interval(batteryPercent: percent, motion: .fast, hasGoodFix: true) == 15)
        }
    }

    @Test func underTenPercentItIsSixtySecondsAndNeverSlower() {
        #expect(PingCadence.interval(batteryPercent: 9, motion: .fast, hasGoodFix: true) == 60)
        #expect(PingCadence.interval(batteryPercent: 0, motion: .still, hasGoodFix: false) == 60)
        for percent in [nil, 0, 5, 9, 10, 20, 21, 100] as [Int?] {
            for motion in [PingCadence.Motion.still, .moving, .fast] {
                let interval = PingCadence.interval(batteryPercent: percent, motion: motion, hasGoodFix: true)
                #expect(interval >= 3 && interval <= Double(TMLSchemaConstants.maxPingIntervalSeconds))
            }
        }
    }

    @Test func anUnknownBatteryCountsAsFull() {
        #expect(PingCadence.interval(batteryPercent: nil, motion: .moving, hasGoodFix: true) == 4)
    }

    @Test func motionComesFromCoreLocationsStationaryFlagThenSpeed() {
        #expect(PingCadence.Motion(speed: 12, stationary: true) == .still)
        #expect(PingCadence.Motion(speed: 5, stationary: false) == .fast)
        #expect(PingCadence.Motion(speed: 1.4, stationary: false) == .moving)
        #expect(PingCadence.Motion(speed: 0.2, stationary: false) == .still)
        #expect(PingCadence.Motion(speed: nil, stationary: false) == .moving)
    }
}
