import Foundation
import Observation

/// Location access with states you set: tests, previews, and the app until Xcode day. Asking
/// gives `answer`, as if the person picked it in the system prompt.
@MainActor
@Observable
public final class FakeLocationAccess: LocationAccess {
    public var authorization: LocationAuthorization
    /// What the While Using prompt answers.
    public var answer: LocationAuthorization.Status
    /// Whether the person leaves Precise Location on in the prompt.
    public var grantsPrecise: Bool
    /// Whether the person allows the one-time precise request.
    public var grantsPreciseOnce: Bool
    /// "whenInUse" and "preciseOnce", in the order asked.
    public private(set) var requests: [String] = []

    public init(authorization: LocationAuthorization = .notAsked, answer: LocationAuthorization.Status = .whenInUse,
                grantsPrecise: Bool = true, grantsPreciseOnce: Bool = true) {
        self.authorization = authorization
        self.answer = answer
        self.grantsPrecise = grantsPrecise
        self.grantsPreciseOnce = grantsPreciseOnce
    }

    public func refresh() async {}

    public func requestWhenInUse() async -> LocationAuthorization {
        requests.append("whenInUse")
        // iOS shows the prompt only while it's undetermined.
        if authorization.status == .notDetermined, authorization.servicesEnabled {
            authorization = LocationAuthorization(status: answer, precise: grantsPrecise, hasAsked: true)
        }
        return authorization
    }

    public func requestPreciseOnce() async -> LocationAuthorization {
        requests.append("preciseOnce")
        if authorization.isAllowed, !authorization.precise, grantsPreciseOnce { authorization.precise = true }
        return authorization
    }

    public var settingsURL: URL? { URL(string: "app-settings:") }
}

/// Location updates you send by hand. It counts open streams and the background sessions they
/// hold, so tests can check that background location runs only while sharing.
@MainActor
public final class FakeLocationStream: LocationStream {
    private var streams: [UUID: (background: Bool, continuation: AsyncStream<LocationUpdate>.Continuation)] = [:]
    /// Every `updates(background:)` call, in order.
    public private(set) var requests: [Bool] = []

    public init() {}

    public func updates(background: Bool) -> AsyncStream<LocationUpdate> {
        let (stream, continuation) = AsyncStream.makeStream(of: LocationUpdate.self)
        let id = UUID()
        requests.append(background)
        streams[id] = (background, continuation)
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor [weak self] in self?.streams[id] = nil }
        }
        return stream
    }

    /// Streams being iterated now.
    public var openStreams: Int { streams.count }
    /// Whether location is running in the background (a background session is held).
    public var isRunningInBackground: Bool { streams.values.contains { $0.background } }

    public func send(_ update: LocationUpdate) {
        for stream in streams.values { stream.continuation.yield(update) }
    }

    public func send(_ fix: LocationFix, stationary: Bool = false, accuracyLimited: Bool = false) {
        send(LocationUpdate(fix: fix, isStationary: stationary, isAccuracyLimited: accuracyLimited))
    }

    /// Ends every stream from the producer's side, as Core Location does when its updates fail.
    public func finishAll() {
        let open = streams
        streams = [:]
        for stream in open.values { stream.continuation.finish() }
    }
}

/// A walk along a route, one fix a second: what the app shows on the fakes, so a viewer page can
/// follow a moving marker. It loops back to the start at the end. Not used by tests.
@MainActor
public final class SimulatedRouteStream: LocationStream {
    /// Waypoints as (latitude, longitude).
    public let route: [(Double, Double)]
    /// Meters per second (1.4 is a walk).
    public let speed: Double
    private let clock: any ShareClock

    /// A walk around Yerba Buena Gardens, San Francisco.
    public nonisolated static let demoRoute: [(Double, Double)] = [
        (37.78508, -122.40249), (37.78595, -122.40141), (37.78486, -122.40004),
        (37.78398, -122.40114), (37.78508, -122.40249),
    ]

    public init(route: [(Double, Double)] = SimulatedRouteStream.demoRoute, speed: Double = 1.4,
                clock: any ShareClock = SystemShareClock()) {
        self.route = route.count >= 2 ? route : SimulatedRouteStream.demoRoute
        self.speed = speed
        self.clock = clock
    }

    public func updates(background: Bool) -> AsyncStream<LocationUpdate> {
        let route = route, speed = speed, clock = clock
        return AsyncStream { continuation in
            let task = Task {
                var traveled = 0.0
                while !Task.isCancelled {
                    let (lat, lng) = Self.position(on: route, at: traveled)
                    continuation.yield(LocationUpdate(fix: LocationFix(latitude: lat, longitude: lng, horizontalAccuracy: 8,
                                                                       timestamp: clock.now, speed: speed)))
                    traveled += speed
                    do { try await clock.sleep(for: .seconds(1)) } catch { break }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The point `distance` meters along the route, looping.
    nonisolated static func position(on route: [(Double, Double)], at distance: Double) -> (Double, Double) {
        let legs = zip(route, route.dropFirst()).map { ($0, $1, ApproximateLocation.meters(from: $0, to: $1)) }
        let total = legs.reduce(0) { $0 + $1.2 }
        guard total > 0 else { return route[0] }
        var left = distance.truncatingRemainder(dividingBy: total)
        for (from, to, length) in legs {
            if left <= length {
                let t = length == 0 ? 0 : left / length
                return (from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t)
            }
            left -= length
        }
        return route[route.count - 1]
    }
}
