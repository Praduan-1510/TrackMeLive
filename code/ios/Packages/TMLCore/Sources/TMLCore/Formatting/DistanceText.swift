import Foundation

/// Distances as the design system writes them (README, "Times and distances").
///
/// - Kilometers: under 1 km in meters rounded to 10 (340 m), 1 to 10 km with one decimal (1.2 km),
///   10 km and up in whole numbers (12 km).
/// - Miles: under 0.1 mi in feet rounded to 10 (300 ft), one decimal under 10 mi (2.5 mi), whole
///   numbers from 10 mi (12 mi).
/// - While the sharer is approximate, round to the nearest 0.5 km (0.5 mi): "about 1 km",
///   "about 1.5 km" or "under 1 km".
///
/// Screens show the short unit ("1.2 km"); VoiceOver gets the long unit ("1.2 kilometers") from
/// `spoken`, built with the locale's formatter rather than by joining strings.
public struct DistanceText: Sendable, Equatable {
    public enum Units: Sendable {
        case metric, imperial

        /// The units the locale measures distance in.
        public init(locale: Locale) {
            self = locale.measurementSystem == .metric ? .metric : .imperial
        }
    }

    /// What's on screen: "1.2 km", "about 1.5 km", "under 1 km".
    public let short: String
    /// What VoiceOver says: "1.2 kilometers", "about 1.5 kilometers", "under 1 kilometer".
    public let spoken: String

    public init(meters: Double, units: Units, approximate: Bool = false, locale: Locale = .current) {
        let value: Double
        let unit: UnitLength
        let fractionDigits: Int
        var prefix = ""

        let big: UnitLength = units == .metric ? .kilometers : .miles
        let inBig = Measurement(value: max(0, meters), unit: UnitLength.meters).converted(to: big).value

        if approximate {
            let rounded = (inBig * 2).rounded() / 2
            if rounded < 1 {
                prefix = "under "
                value = 1
                fractionDigits = 0
            } else {
                prefix = "about "
                value = rounded
                fractionDigits = rounded == rounded.rounded() ? 0 : 1
            }
            unit = big
        } else if units == .metric, (max(0, meters) / 10).rounded() * 10 < 1_000 {
            value = (max(0, meters) / 10).rounded() * 10
            unit = .meters
            fractionDigits = 0
        } else if units == .imperial, inBig < 0.1 {
            let feet = Measurement(value: max(0, meters), unit: UnitLength.meters).converted(to: .feet).value
            value = (feet / 10).rounded() * 10
            unit = .feet
            fractionDigits = 0
        } else if (inBig * 10).rounded() / 10 < 10 {
            value = (inBig * 10).rounded() / 10
            unit = big
            fractionDigits = 1
        } else {
            value = inBig.rounded()
            unit = big
            fractionDigits = 0
        }

        let number = value.formatted(.number.precision(.fractionLength(fractionDigits)).locale(locale))
        short = prefix + number + " " + Self.symbol(for: unit)

        let measurement = Measurement(value: value, unit: unit)
        let long = measurement.formatted(
            .measurement(width: .wide, usage: .asProvided,
                         numberFormatStyle: .number.precision(.fractionLength(fractionDigits)))
            .locale(locale)
        )
        spoken = prefix + long
    }

    private static func symbol(for unit: UnitLength) -> String {
        switch unit {
        case .meters: "m"
        case .kilometers: "km"
        case .feet: "ft"
        default: "mi"
        }
    }
}
