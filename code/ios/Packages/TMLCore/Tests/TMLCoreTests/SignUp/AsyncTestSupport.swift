import Foundation
import Testing
@testable import TMLCore

/// Waits for main-actor work started by a model (its tasks, a listener's first snapshot) to land.
/// Nothing here sleeps for real time unless the condition stays false for a while.
@MainActor
func eventually(_ condition: () -> Bool, timeout: Duration = .seconds(2)) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now + timeout
    while !condition() {
        if clock.now >= deadline { return false }
        await Task.yield()
        if !condition() { try? await Task.sleep(for: .milliseconds(1)) }
    }
    return true
}

/// A UserDefaults suite of its own, removed when the test is done.
final class ScratchDefaults {
    let name = "tml.tests.\(UUID().uuidString)"
    let defaults: UserDefaults

    init() throws {
        defaults = try #require(UserDefaults(suiteName: name))
    }

    deinit { defaults.removePersistentDomain(forName: name) }
}

extension PhoneNumber {
    static let alex = PhoneNumber(regionCode: "US", callingCode: "1", nationalNumber: "4155550142")
}

extension TMLUser {
    static func sample(name: String = "Alex", mascot: TMLMascotId = .fox) -> TMLUser {
        TMLUser(
            name: name, mascotId: mascot, mascotColor: .original, settings: .defaults,
            createdAt: Date(timeIntervalSince1970: 1_000), updatedAt: Date(timeIntervalSince1970: 1_000)
        )
    }
}
