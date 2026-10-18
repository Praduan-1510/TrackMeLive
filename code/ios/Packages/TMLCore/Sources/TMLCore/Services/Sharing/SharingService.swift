import Foundation

/// How the sharer's own pings are going: the live sheet's row for "You" ("Precise · every 5 s",
/// "No GPS signal", "No connection"; prototype `alexDetail`, FSD §7 Offline behavior).
public enum UploadStatus: Hashable, Sendable {
    /// Just started: no fix yet, and under 30 s since the start. Screens show it as live.
    case waitingForFix
    /// Pings are reaching the server.
    case live
    /// No fix better than 100 m for 30 s. `lastFixAt` is the newest sent ping's time, by the
    /// server's clock, if there was one.
    case noSignal(lastFixAt: Date?)
    /// Writes aren't reaching the server (offline, or it keeps refusing for now). The uploader
    /// retries with backoff, one write at a time.
    case offline
}

/// Where the viewer sees the sharer: the newest ping the server accepted, exactly as written
/// (rounded to the ~500 m grid, with an accuracy of at least 500 m, when Approximate). Both maps
/// show the same point (FSD §4 Location detail).
public struct SharedPoint: Hashable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var accuracyM: Double
    /// When the fix was taken, by the server's clock: Last seen uses it.
    public var recordedAt: Date
    public var precision: TMLPrecision

    public init(latitude: Double, longitude: Double, accuracyM: Double, recordedAt: Date, precision: TMLPrecision) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracyM = accuracyM
        self.recordedAt = recordedAt
        self.precision = precision
    }

    public init(_ write: PingWrite) {
        self.init(latitude: write.ping.lat, longitude: write.ping.lng, accuracyM: write.ping.accuracyM,
                  recordedAt: write.ping.recordedAt, precision: write.precision)
    }
}

/// A share in progress: what the live screen, the timer sheet and the share sheet need.
public struct LiveShare: Hashable, Sendable {
    public var sessionId: String
    /// The link for the share sheet; Send link again reuses it.
    public var link: ShareLink
    /// Who it's for, when a name was given. Copy says "they" without one.
    public var viewerName: String?
    public var startedAt: Date
    public var expiresAt: Date
    public var stopRule: TMLStopRule
    public var stopMinutes: TMLStopMinutes?
    public var stopAt: Date?
    /// The precision pings are written at now.
    public var precision: TMLPrecision
    /// A change waiting for the next ping ("From the next update"); nil when none.
    public var precisionNext: TMLPrecision?
    /// The call the session started with; nil for a manual share.
    public var callId: String?
    /// The session's call is connected (Live Together).
    public var callActive: Bool
    public var callEnded: Bool
    public var shareBackAllowed: Bool
    /// When the link was first opened; nil until then.
    public var firstViewedAt: Date?
    public var viewerSharing: Bool
    public var shareBackRequestedAt: Date?
    /// The ping interval in use, in seconds: the sharer's row shows it.
    public var pingInterval: Double
    public var upload: UploadStatus
    /// The newest point the viewer can see; nil until the first ping is written.
    public var lastPoint: SharedPoint?
    /// The phone's estimate of the server's clock; use `clock.server(Date())` for "now".
    public var clock: ServerClock

    public init(sessionId: String, link: ShareLink, viewerName: String?, startedAt: Date, expiresAt: Date,
                stopRule: TMLStopRule, stopMinutes: TMLStopMinutes?, stopAt: Date?, precision: TMLPrecision,
                precisionNext: TMLPrecision? = nil, callId: String?, callActive: Bool, callEnded: Bool = false,
                shareBackAllowed: Bool, firstViewedAt: Date? = nil, viewerSharing: Bool = false,
                shareBackRequestedAt: Date? = nil, pingInterval: Double, upload: UploadStatus,
                lastPoint: SharedPoint? = nil, clock: ServerClock) {
        self.sessionId = sessionId
        self.link = link
        self.viewerName = viewerName
        self.startedAt = startedAt
        self.expiresAt = expiresAt
        self.stopRule = stopRule
        self.stopMinutes = stopMinutes
        self.stopAt = stopAt
        self.precision = precision
        self.precisionNext = precisionNext
        self.callId = callId
        self.callActive = callActive
        self.callEnded = callEnded
        self.shareBackAllowed = shareBackAllowed
        self.firstViewedAt = firstViewedAt
        self.viewerSharing = viewerSharing
        self.shareBackRequestedAt = shareBackRequestedAt
        self.pingInterval = pingInterval
        self.upload = upload
        self.lastPoint = lastPoint
        self.clock = clock
    }

    /// When it stops, and the timer sheet's choices.
    public var countdown: ShareCountdown { ShareCountdown(expiresAt: expiresAt, stopRule: stopRule, stopAt: stopAt) }

    /// The stop rule as the timer sheet's selected choice.
    public var stopChoice: StopChoice {
        switch stopRule {
        case .call: .call
        case .limit: .limit
        case .minutes: .minutes(stopMinutes ?? .minutes30)
        }
    }

    /// The precision the live screen's control shows: the pending one when there is one.
    public var chosenPrecision: TMLPrecision { precisionNext ?? precision }

    /// Whether When the call ends can be picked now: the session's own call is still connected.
    public var callChoiceAvailable: Bool { callId != nil && callActive && !callEnded }
}

/// The share as the app shows it.
public enum ShareState: Hashable, Sendable {
    /// No share yet, or Done on the ended screen.
    case idle
    /// `createSession` is on its way.
    case starting
    case live(LiveShare)
    case ended(EndedShare)

    public var live: LiveShare? { if case .live(let share) = self { share } else { nil } }
    public var ended: EndedShare? { if case .ended(let share) = self { share } else { nil } }
    public var isActive: Bool { live != nil }
}

/// Sharing, as the share, live and ended screens use it (FSD §4 Live map link, Stop rule, Location
/// detail, Stop sharing, Auto-expiry). One session at a time.
///
/// The app passes a `ShareController`, which runs the session: the callables, the session
/// listener, location in the background and the ping uploader. Implementations are
/// `@Observable`, so screens follow `state`. Previews use `FixedSharingService`.
///
/// Location access is the caller's first step (`LocationAccess`, `LocationGate`): `start` refuses
/// with `.locationOff` without it, and shares Approximate when Precise Location is off.
@MainActor
public protocol SharingService: AnyObject {
    var state: ShareState { get }
    /// Creates the session and starts location and pings; the state is `.live` when it returns.
    /// Returns the link to hand to the system share sheet at once.
    ///
    /// Pings start before the sheet closes: only this phone has the link until the sheet sends it,
    /// so nobody can read them, `discard()` deletes them with the session, and the person who opens
    /// the link sees a position at once.
    func start(_ options: ShareOptions) async throws(SharingError) -> ShareLink
    /// The share sheet closed without a choice: pings stop, the state goes back to idle, and the
    /// session is deleted before anyone can see it (`discardSession`, retried in the background
    /// while offline). Throws only `.linkOpened`: the link was opened meanwhile, so the share
    /// carries on and the state stays `.live`.
    func discard() async throws(SharingError)
    /// Stop: pings stop at once and the ended screen shows; then `stopSession`, retried until the
    /// server has it (`EndedShare.confirmed`).
    func stop() async
    /// The timer sheet's choice, applied on screen at once and rolled back if the write fails.
    func changeStop(to choice: StopChoice) async throws(SharingError)
    /// Precise or Approximate from the next ping. Approximate applies to the next ping even if
    /// the write fails, so a mistaken tap never shares more than intended.
    func changePrecision(to precision: TMLPrecision) async throws(SharingError)
    /// Done (or Share again) on the ended screen: back to idle.
    func dismissEnded()
}
