import Foundation
#if os(iOS)
import UIKit
#endif

/// Wall-clock time and waiting, for the sharing layer. Tests pass `ManualShareClock`, so cadence,
/// backoff and expiry run without real time passing.
public protocol ShareClock: Sendable {
    /// The phone's clock.
    var now: Date { get }
    /// Waits `duration`; throws `CancellationError` when the task is cancelled.
    func sleep(for duration: Duration) async throws
}

/// The real clock.
public struct SystemShareClock: ShareClock {
    public init() {}

    public var now: Date { Date() }

    public func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}

/// The battery level, which sets the ping interval (FSD §4 Battery-aware pings).
@MainActor
public protocol BatteryMonitor: AnyObject {
    /// 0–100, or nil when unknown (the Simulator reports none).
    var percent: Int? { get }
}

/// A battery at a level you set: tests and previews.
@MainActor
public final class FixedBattery: BatteryMonitor {
    public var percent: Int?

    public init(percent: Int? = 100) {
        self.percent = percent
    }
}

#if os(iOS)
/// `UIDevice`'s battery level. Monitoring is on from the first share; it costs nothing measurable.
@MainActor
public final class DeviceBattery: BatteryMonitor {
    public init() {
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    public var percent: Int? {
        let level = UIDevice.current.batteryLevel
        return level < 0 ? nil : Int((level * 100).rounded())
    }
}
#endif
