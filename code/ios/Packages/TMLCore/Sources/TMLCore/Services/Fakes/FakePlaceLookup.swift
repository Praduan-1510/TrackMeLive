import Foundation

/// Reverse geocoding with answers you set: tests, and the app on the fakes.
///
/// Each lookup answers the first of `answers`, then `answer`. While `holds` is true, lookups wait
/// until `release()` or until their task is cancelled, which answers `.failed` like the real one.
@MainActor
public final class FakePlaceLookup: PlaceLookup {
    /// What lookups answer once `answers` is used up.
    public var answer: PlaceLookupResult
    /// The next lookups answer these, in order.
    public var answers: [PlaceLookupResult] = []
    /// While true, lookups wait for `release()` (a slow network) or cancellation.
    public var holds = false
    /// Every point looked up, as (latitude, longitude), in order.
    public private(set) var requests: [Point] = []
    /// Lookups that ended because their task was cancelled.
    public private(set) var cancellations = 0

    public struct Point: Hashable, Sendable {
        public var latitude: Double
        public var longitude: Double
    }

    private var waiting: [UUID: CheckedContinuation<Void, Never>] = [:]

    public init(_ answer: PlaceLookupResult = .nothing) {
        self.answer = answer
    }

    /// The fakes' route walks around Yerba Buena Gardens, San Francisco.
    public static var demo: FakePlaceLookup {
        let parts = PlaceParts(name: "Yerba Buena Gardens", street: "Mission St", area: "Yerba Buena", city: "San Francisco")
        return FakePlaceLookup(parts.map(PlaceLookupResult.found) ?? .nothing)
    }

    /// Lookups waiting for `release()`.
    public var heldLookups: Int { waiting.count }

    public func lookUp(latitude: Double, longitude: Double) async -> PlaceLookupResult {
        requests.append(Point(latitude: latitude, longitude: longitude))
        let result = answers.isEmpty ? answer : answers.removeFirst()
        if holds {
            let id = UUID()
            await withTaskCancellationHandler {
                await withCheckedContinuation { waiting[id] = $0 }
            } onCancel: {
                Task { @MainActor [weak self] in self?.resume(id) }
            }
        }
        if Task.isCancelled {
            cancellations += 1
            return .failed
        }
        return result
    }

    /// Lets held lookups answer.
    public func release() {
        holds = false
        for id in Array(waiting.keys) { resume(id) }
    }

    private func resume(_ id: UUID) {
        waiting.removeValue(forKey: id)?.resume()
    }
}
