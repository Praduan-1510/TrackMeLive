#if canImport(MapKit)
import CoreLocation
import Foundation
import MapKit

/// Apple's free reverse geocoder on the sharer's phone (owner decision Oct 19: no Google;
/// x-decisions Q-PLACE).
///
/// It uses MapKit's `MKReverseGeocodingRequest` (iOS 26), which replaces `CLGeocoder`:
/// iOS 26 deprecates `CLGeocoder.reverseGeocodeLocation` with "Use MKReverseGeocodingRequest".
/// The parts come from each map item's `placemark` (thoroughfare, subLocality, locality,
/// areasOfInterest), which iOS 26 deprecates too. Its stated replacements, `address` and
/// `addressRepresentations`, give only whole address lines, the city and the region, with no
/// street, neighbourhood or area of interest, so `placemark` is the one source. That is this
/// file's one deprecation warning (README, Place).
///
/// Errors, rate limiting (`MKError.loadingThrottled`), cancellation and no network are `.failed`;
/// an answer without a usable part is `.nothing`. Cancelling the task cancels the request and
/// returns at once.
@MainActor
public final class LivePlaceLookup: PlaceLookup {
    public init() {}

    public func lookUp(latitude: Double, longitude: Double) async -> PlaceLookupResult {
        guard !Task.isCancelled,
              let request = MKReverseGeocodingRequest(location: CLLocation(latitude: latitude, longitude: longitude))
        else { return .failed }
        let addresses: [GeocodedAddress]
        do {
            addresses = try await Self.addresses(request)
        } catch {
            return .failed
        }
        if Task.isCancelled { return .failed }
        for address in addresses {
            if let parts = PlaceParts(address) { return .found(parts) }
        }
        return .nothing
    }

    /// The request's answer as plain values. Cancelling the task cancels the request, and the wait
    /// ends at once even if MapKit answers later.
    private static func addresses(_ request: MKReverseGeocodingRequest) async throws -> [GeocodedAddress] {
        let pending = PendingRequest(request)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[GeocodedAddress], any Error>) in
                pending.start(continuation)
            }
        } onCancel: {
            Task { @MainActor in pending.cancel() }
        }
    }
}

/// One request and the wait for it, answered exactly once: by MapKit, or by cancellation.
/// Used only on the main actor; `@unchecked Sendable` lets the cancellation handler hold it.
private final class PendingRequest: @unchecked Sendable {
    private let request: MKReverseGeocodingRequest
    private var continuation: CheckedContinuation<[GeocodedAddress], any Error>?
    private var cancelled = false

    init(_ request: MKReverseGeocodingRequest) {
        self.request = request
    }

    @MainActor
    func start(_ continuation: CheckedContinuation<[GeocodedAddress], any Error>) {
        if cancelled {
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        request.getMapItems { [self] items, error in
            MainActor.assumeIsolated {
                if let items {
                    self.finish(.success(items.map { GeocodedAddress($0) }))
                } else {
                    self.finish(.failure(error ?? CancellationError()))
                }
            }
        }
    }

    @MainActor
    func cancel() {
        cancelled = true
        request.cancel()
        finish(.failure(CancellationError()))
    }

    @MainActor
    private func finish(_ result: Result<[GeocodedAddress], any Error>) {
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(with: result)
    }
}

extension GeocodedAddress {
    /// A map item's placemark fields.
    init(_ item: MKMapItem) {
        // Deprecated in iOS 26 with no replacement for these fields; see LivePlaceLookup.
        let placemark = item.placemark
        self.init(name: placemark.name ?? item.name, areasOfInterest: placemark.areasOfInterest ?? [],
                  thoroughfare: placemark.thoroughfare, subThoroughfare: placemark.subThoroughfare,
                  subLocality: placemark.subLocality, locality: placemark.locality,
                  subAdministrativeArea: placemark.subAdministrativeArea,
                  administrativeArea: placemark.administrativeArea, postalCode: placemark.postalCode,
                  country: placemark.country)
    }
}
#endif
