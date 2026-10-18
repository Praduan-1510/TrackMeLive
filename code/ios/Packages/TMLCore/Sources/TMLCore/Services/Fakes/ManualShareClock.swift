import Foundation
import Synchronization

/// A clock that moves only when a test says so. `sleep` waits until `advance` passes its deadline;
/// cancelling the sleeping task ends it at once with `CancellationError`, like `Task.sleep`.
public final class ManualShareClock: ShareClock {
    private struct Waiter {
        let id: UUID
        let deadline: Date
        let continuation: CheckedContinuation<Void, any Error>
    }

    private struct State {
        var now: Date
        var waiters: [Waiter] = []
        /// Sleeps cancelled before they registered.
        var cancelled: Set<UUID> = []
    }

    private let state: Mutex<State>

    public init(now: Date = Date(timeIntervalSince1970: 1_800_000_000)) {
        state = Mutex(State(now: now))
    }

    public var now: Date { state.withLock { $0.now } }

    /// How many sleeps are waiting.
    public var sleepers: Int { state.withLock { $0.waiters.count } }

    public func sleep(for duration: Duration) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                let outcome: Result<Void, any Error>? = state.withLock { state in
                    if state.cancelled.remove(id) != nil { return .failure(CancellationError()) }
                    if duration <= .zero { return .success(()) }
                    let deadline = state.now.addingTimeInterval(duration.timeInterval)
                    state.waiters.append(Waiter(id: id, deadline: deadline, continuation: continuation))
                    return nil
                }
                if let outcome { continuation.resume(with: outcome) }
            }
        } onCancel: {
            let waiter: Waiter? = state.withLock { state in
                if let index = state.waiters.firstIndex(where: { $0.id == id }) {
                    return state.waiters.remove(at: index)
                }
                state.cancelled.insert(id)
                return nil
            }
            waiter?.continuation.resume(throwing: CancellationError())
        }
    }

    /// Moves time forward by `duration`, waking each sleep whose deadline it passes, in deadline
    /// order, and letting the woken work run before going on (so a loop that sleeps again inside
    /// the window wakes again too). Work already started gets to run first, so a sleep it is about
    /// to begin counts from now, not from after the jump.
    @MainActor
    public func advance(by duration: Duration) async {
        await Self.settle()
        let target = now.addingTimeInterval(duration.timeInterval)
        while true {
            let next: Waiter? = state.withLock { state in
                guard let index = state.waiters.indices.min(by: { state.waiters[$0].deadline < state.waiters[$1].deadline }),
                      state.waiters[index].deadline <= target else { return nil }
                let waiter = state.waiters.remove(at: index)
                state.now = max(state.now, waiter.deadline)
                return waiter
            }
            guard let next else { break }
            next.continuation.resume()
            await Self.settle()
        }
        state.withLock { $0.now = max($0.now, target) }
        await Self.settle()
    }

    /// Sets the clock without waking anyone: a phone whose clock jumped.
    public func set(_ date: Date) {
        state.withLock { $0.now = date }
    }

    /// Lets main-actor work that was just made runnable run.
    @MainActor
    public static func settle() async {
        for _ in 0..<40 { await Task.yield() }
    }
}

extension Duration {
    /// In seconds, as `TimeInterval`.
    var timeInterval: TimeInterval {
        let (seconds, attoseconds) = components
        return TimeInterval(seconds) + TimeInterval(attoseconds) / 1e18
    }
}
