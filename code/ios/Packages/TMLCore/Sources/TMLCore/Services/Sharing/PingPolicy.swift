import Foundation

/// Approximate, as the phone applies it before a ping is written (FSD §4 Location detail): each
/// point snapped to a grid about 500 m across, and the accuracy raised to at least 500 m
/// (x-decisions Q-ACCURACY-APPROX), which the rules check.
///
/// The grid is fixed to the globe, not to the sharer: rows every 500 m of latitude, and in each
/// row, columns every 500 m of longitude at that row's latitude. Every point in a cell gives the
/// same rounded point, so walking around inside a cell reveals nothing, and the rounded point is
/// never more than about 354 m (half a cell's diagonal) from the real one.
public enum ApproximateLocation {
    /// Meters in one degree of latitude (and of longitude at the equator).
    public static let metersPerDegree = 111_320.0
    public static var cellMeters: Double { Double(TMLSchemaConstants.approximateRoundingMeters) }

    /// The grid point for a position.
    public static func round(latitude: Double, longitude: Double) -> (latitude: Double, longitude: Double) {
        let latStep = cellMeters / metersPerDegree
        let lat = min(90, max(-90, (latitude / latStep).rounded() * latStep))
        let metersPerLngDegree = metersPerDegree * cos(lat * .pi / 180)
        // Within a cell of a pole every longitude is the same place.
        guard metersPerLngDegree > cellMeters / 180 else { return (lat, 0) }
        let lngStep = cellMeters / metersPerLngDegree
        var lng = (longitude / lngStep).rounded() * lngStep
        if lng > 180 { lng -= 360 }
        if lng < -180 { lng += 360 }
        return (lat, lng)
    }

    /// The ping for a fix at `precision`, timed `recordedAt` (the server's clock).
    public static func ping(for fix: LocationFix, precision: TMLPrecision, recordedAt: Date) -> TMLPing {
        switch precision {
        case .precise:
            return TMLPing(lat: fix.latitude, lng: fix.longitude, accuracyM: fix.horizontalAccuracy, recordedAt: recordedAt)
        case .approximate:
            let rounded = round(latitude: fix.latitude, longitude: fix.longitude)
            return TMLPing(lat: rounded.latitude, lng: rounded.longitude,
                           accuracyM: max(fix.horizontalAccuracy, cellMeters), recordedAt: recordedAt)
        }
    }

    /// The great-circle distance in meters (haversine).
    public static func meters(from a: (Double, Double), to b: (Double, Double)) -> Double {
        let radius = 6_371_000.0
        let lat1 = a.0 * .pi / 180, lat2 = b.0 * .pi / 180
        let dLat = lat2 - lat1, dLng = (b.1 - a.1) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * radius * asin(min(1, sqrt(h)))
    }
}

/// How often the sharer's phone pings (FSD §4 Battery-aware pings, §7 Battery): every 3–5 s above
/// 20% battery, every 15 s from 20% to 10%, every 60 s under 10%, never less than once a minute.
///
/// Within 3–5 s, movement and accuracy decide: a phone moving at speed pings every 3 s, so the
/// marker keeps up; one moving slowly every 4 s; one standing still, or without a fix good
/// enough to show, every 5 s, since a faster ping would show nothing new.
public enum PingCadence {
    /// Faster than this (m/s, about 18 km/h: cycling, driving) is "at speed".
    public static let fastSpeed = 5.0
    /// Slower than this (m/s) counts as standing still when Core Location doesn't say.
    public static let stillSpeed = 0.5

    public enum Motion: Hashable, Sendable {
        case still
        case moving
        case fast

        /// From a fix's speed and Core Location's stationary flag. No speed reads as moving, so a
        /// phone that can't tell never pings slower than it needs to.
        public init(speed: Double?, stationary: Bool) {
            if stationary {
                self = .still
            } else if let speed {
                self = speed >= PingCadence.fastSpeed ? .fast : speed < PingCadence.stillSpeed ? .still : .moving
            } else {
                self = .moving
            }
        }
    }

    /// The interval in seconds. `batteryPercent` nil (unknown) counts as a full battery.
    public static func interval(batteryPercent: Int?, motion: Motion, hasGoodFix: Bool) -> Double {
        let battery = batteryPercent ?? 100
        if battery < TMLSchemaConstants.criticalBatteryPercent {
            return Double(TMLSchemaConstants.pingIntervalCriticalBatterySeconds)
        }
        if battery <= TMLSchemaConstants.lowBatteryPercent {
            return Double(TMLSchemaConstants.pingIntervalLowBatterySeconds)
        }
        guard hasGoodFix else { return 5 }
        switch motion {
        case .fast: return 3
        case .moving: return 4
        case .still: return 5
        }
    }
}
