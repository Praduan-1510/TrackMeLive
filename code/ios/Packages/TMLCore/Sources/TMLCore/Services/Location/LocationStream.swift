import Foundation

/// One position from the phone, in the units Core Location reports. Nothing here is rounded: the
/// ping uploader applies Approximate (`ApproximateLocation`) just before a ping is written.
public struct LocationFix: Hashable, Sendable {
    /// WGS 84 degrees.
    public var latitude: Double
    public var longitude: Double
    /// Horizontal accuracy in meters, the radius of uncertainty. Negative means the fix is invalid.
    public var horizontalAccuracy: Double
    /// When the fix was taken, by the phone's clock (the uploader converts it to server time).
    public var timestamp: Date
    /// Meters per second, or nil when unknown (Core Location reports a negative speed then).
    public var speed: Double?

    public init(latitude: Double, longitude: Double, horizontalAccuracy: Double, timestamp: Date, speed: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.horizontalAccuracy = horizontalAccuracy
        self.timestamp = timestamp
        self.speed = speed
    }

    /// A real position: coordinates in range and an accuracy Core Location vouches for.
    public var isValid: Bool {
        horizontalAccuracy >= 0 && horizontalAccuracy.isFinite
            && (-90...90).contains(latitude) && (-180...180).contains(longitude)
    }
}

/// Why updates have no position, as `CLLocationUpdate`'s diagnostics say.
public enum LocationProblem: Hashable, Sendable {
    /// Location is off for Track Me Live.
    case denied
    /// Location Services is off for the whole phone.
    case servicesOff
    /// Screen Time or a device profile blocks location; the person can't change it in Settings.
    case restricted
    /// The app isn't in use, so a While Using grant doesn't cover it (the background session was lost).
    case notInUse
    /// Core Location can't get a position right now (no signal).
    case unavailable
}

/// One element of the live updates: a position, a "still here" without a new one, or a problem.
public struct LocationUpdate: Hashable, Sendable {
    /// The newest position, when this update carries one.
    public var fix: LocationFix?
    /// The phone hasn't moved: Core Location pauses new positions until it does, and the last one
    /// still stands.
    public var isStationary: Bool
    /// Precise Location is off for the app, so positions are only accurate to a few kilometers.
    public var isAccuracyLimited: Bool
    public var problem: LocationProblem?

    public init(fix: LocationFix? = nil, isStationary: Bool = false, isAccuracyLimited: Bool = false, problem: LocationProblem? = nil) {
        self.fix = fix
        self.isStationary = isStationary
        self.isAccuracyLimited = isAccuracyLimited
        self.problem = problem
    }
}

/// Live location for a share (FSD §7, §8 Background sharing).
///
/// Updates flow while the returned stream is iterated, and stop when it ends: the consumer
/// cancels its task, or drops the stream. With `background`, they keep coming while the app is in
/// the background, through a `CLBackgroundActivitySession` held for exactly that stream's life. It
/// must be asked for while the app is in the foreground, which is where sharing always starts.
///
/// The share controller opens one stream when a session starts and ends it when the session ends,
/// so location runs in the background only while sharing.
///
/// Implementations: `LiveLocationStream` (Core Location), `FakeLocationStream` (tests, previews).
@MainActor
public protocol LocationStream: AnyObject {
    func updates(background: Bool) -> AsyncStream<LocationUpdate>
}
