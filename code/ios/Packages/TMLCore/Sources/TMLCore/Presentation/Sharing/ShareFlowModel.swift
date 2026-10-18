import Foundation
import Observation

/// The screens Home's navigation stack pushes for sharing.
public enum ShareDestination: Hashable, Sendable {
    /// Who it's for, Stops, Location, then Share live location.
    case share
    /// The map and its sheet while sharing.
    case live
    /// After a share ends.
    case ended
}

/// Sharing from Home, end to end (prototype `openShare`, `startSession`, `endSession`, `done`,
/// `shareAgain`): the location step, the share screen, the live screen and the ended screen, on
/// Home's navigation stack, so Back always does what it looks like it does.
///
/// - Share live location runs the location step first; once location is allowed, the share screen
///   is pushed. While a share runs it opens the live screen instead.
/// - When the link goes out, the live screen replaces the share screen, so Back can't return to a
///   form for a share that's already running. The live screen's Home button pops to Home.
/// - When the share ends (Stop, the timer, the limit, or on the server), the ended screen replaces
///   whatever sharing screen is up; Done goes back to Home. At the limit, Share again starts a new
///   share with the same choices and opens the share sheet at once.
@MainActor
@Observable
public final class ShareFlowModel {
    /// Home's stack.
    public var path: [ShareDestination] = []
    public let gate: LocationGateModel
    public private(set) var setup: ShareSetupModel?
    public let live: LiveSessionModel

    @ObservationIgnored public let sharing: any SharingService
    @ObservationIgnored private let access: any LocationAccess
    @ObservationIgnored private let profile: @MainActor () -> TMLUser?
    /// The last share's choices, for Share again.
    @ObservationIgnored private var lastChoices: (viewerName: String?, stop: StopChoice, precision: TMLPrecision)?

    public init(sharing: any SharingService, access: any LocationAccess, permissions: any PermissionsService,
                profile: @escaping @MainActor () -> TMLUser?) {
        self.sharing = sharing
        self.access = access
        self.profile = profile
        gate = LocationGateModel(access: access)
        live = LiveSessionModel(sharing: sharing, access: access, permissions: permissions,
                                sharerName: { profile()?.name ?? "" })
    }

    // MARK: Starting

    /// Home's Share live location, the Share location control, or `trackmelive://share`.
    public func startShare() async {
        if sharing.state.isActive {
            path = [.live]
            return
        }
        guard let user = profile() else { return }
        await gate.begin(wanting: user.settings.precision) { [weak self] precision, _ in
            self?.showSetup(for: user, precision: precision)
        }
    }

    /// The ended screen's Share again (at the limit): a new session with a new link, with the same
    /// choices, straight to the share sheet.
    public func shareAgain() async {
        let previous = sharing.state.ended?.viewerName
        sharing.dismissEnded()
        path = []
        guard let user = profile() else { return }
        await gate.begin(wanting: lastChoices?.precision ?? user.settings.precision) { [weak self] precision, _ in
            guard let self else { return }
            let setup = self.showSetup(for: user, precision: precision, viewerName: previous ?? lastChoices?.viewerName)
            if let stop = lastChoices?.stop, stop != .limit { setup.choose(stop: stop) }
            Task { await setup.share() }
        }
    }

    @discardableResult
    private func showSetup(for user: TMLUser, precision: TMLPrecision, viewerName: String? = nil) -> ShareSetupModel {
        let setup = ShareSetupModel(
            settings: user.settings,
            lastViewerName: viewerName ?? user.lastViewerName,
            sharerName: user.name,
            gatePrecision: precision,
            sharing: sharing,
            access: access,
            onShared: { [weak self] copied in self?.didShare(copied: copied) }
        )
        self.setup = setup
        path = [.share]
        return setup
    }

    private func didShare(copied: Bool) {
        if let setup {
            lastChoices = (setup.viewerName, setup.stop, setup.precision)
        }
        setup = nil
        path = [.live]
        if copied { live.linkCopied() }
        Task { await live.linkWasSent() }
    }

    // MARK: Following the share

    /// Call when `sharing.state` changes: the ended screen replaces the live one, and an idle
    /// share leaves no sharing screen behind.
    public func stateDidChange() {
        switch sharing.state {
        case .ended:
            // Mid-setup there's nothing of this share on screen; anywhere else, say it ended.
            if !path.contains(.share) { path = [.ended] }
            live.isConfirmingStop = false
            live.isChoosingStop = false
            live.shareSheet = nil
        case .idle:
            path.removeAll { $0 == .live || $0 == .ended }
        case .live, .starting:
            break
        }
    }

    /// The live screen's Home button.
    public func goHome() {
        path = []
    }

    /// The ended screen's Done.
    public func done() {
        sharing.dismissEnded()
        path = []
    }

    /// `trackmelive://live` (tapping the Live Activity) and `trackmelive://stop` (its Stop sharing,
    /// which opens the app to confirm).
    public func open(_ route: TMLCore.Route) async {
        switch route {
        case .share:
            await startShare()
        case .live, .stop:
            switch sharing.state {
            case .live:
                path = [.live]
                if route == .stop { live.requestStop() }
            case .ended:
                path = [.ended]
            case .idle, .starting:
                break
            }
        }
    }

    /// The app is active again: a share waiting on Settings carries on.
    public func appDidBecomeActive() async {
        await gate.appDidBecomeActive()
    }
}

/// Home's card while a share runs (prototype `viewHome` › live card): "Sharing with Mom" over
/// "Tap to open the map.", or nil when nothing is being shared.
public struct HomeShareCard: Equatable, Sendable {
    public let title: String
    public let message: String

    public init?(state: ShareState, liveTogether: Bool = ShareFeatures.liveTogether) {
        guard let live = state.live else { return nil }
        title = ShareAudience(live.viewerName).name.map { "Sharing with \(PersonName.isolated($0))" } ?? "Sharing live"
        message = (liveTogether && live.viewerSharing ? "You\u{2019}re both live. " : "") + "Tap to open the map."
    }
}
