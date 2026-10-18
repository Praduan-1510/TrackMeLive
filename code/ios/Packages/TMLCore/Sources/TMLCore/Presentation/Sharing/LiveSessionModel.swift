import Foundation
import Observation

/// The live screen while sharing (FSD §4 Stop rule, Location detail, Stop sharing, Live map link;
/// prototype `viewLive`): the words come from `LivePresentation`, and this model runs what the
/// sheet's controls do. Change timer opens the timer sheet, Send link again reopens the share
/// sheet with the same link, the Location control changes precision from the next update, and Stop
/// sharing asks first.
@MainActor
@Observable
public final class LiveSessionModel {
    /// The timer sheet is up.
    public var isChoosingStop = false
    /// The Stop sharing confirmation is up.
    public var isConfirmingStop = false
    /// The share sheet's content while Send link again has it up.
    public var shareSheet: ShareLinkMessage?
    /// A short line the screen shows for a moment and announces politely ("Link copied…").
    public private(set) var toast: String?
    /// Why the last change didn't work, said in the sheet.
    public private(set) var error: SharingError?
    /// The Precise Location alert, when the one-time request leaves it off.
    public var prompt: LocationPrompt?
    /// The notifications explainer, once, right after the first link goes out (FSD §8).
    public var notificationsPrompt: NotificationsPrompt?
    /// Stop is on its way.
    public private(set) var isStopping = false

    @ObservationIgnored public let sharing: any SharingService
    @ObservationIgnored private let access: any LocationAccess
    @ObservationIgnored private let permissions: any PermissionsService
    @ObservationIgnored private let sharerName: @MainActor () -> String
    @ObservationIgnored private var toastID = 0

    public init(sharing: any SharingService, access: any LocationAccess, permissions: any PermissionsService,
                sharerName: @escaping @MainActor () -> String) {
        self.sharing = sharing
        self.access = access
        self.permissions = permissions
        self.sharerName = sharerName
    }

    /// The share on screen, while there is one.
    public var share: LiveShare? { sharing.state.live }

    /// The screen's words at `date` (the device's clock; the share's clock turns it into the
    /// server's), or nil once the share has ended.
    public func presentation(at date: Date) -> LivePresentation? {
        guard let share else { return nil }
        return LivePresentation(share: share, now: share.clock.server(date), preciseAllowed: access.authorization.precise)
    }

    /// The timer sheet at `date`: the choices still on offer, with the current one marked. A timer
    /// that now ends at the limit reads as At the 1-hour limit.
    public func timerSheet(at date: Date) -> TimerSheetPresentation? {
        guard let share else { return nil }
        let callAvailable = ShareFeatures.liveTogether && share.callChoiceAvailable
        let choices = share.countdown.choices(at: share.clock.server(date), callAvailable: callAvailable)
        let selected: StopChoice = share.stopRule != .call && share.countdown.endsAtLimit ? .limit : share.stopChoice
        return TimerSheetPresentation(choices: choices, selected: selected, expiresAt: share.expiresAt,
                                      callOffered: callAvailable)
    }

    // MARK: Controls

    /// A choice in the timer sheet. The sheet closes at once; a failed write says why.
    public func choose(stop choice: StopChoice) async {
        isChoosingStop = false
        error = nil
        do {
            try await sharing.changeStop(to: choice)
        } catch {
            self.error = error
        }
    }

    /// The Location control: from the next update. Precise while it's off for the app asks for the
    /// system's one-time precise access first.
    public func choose(precision option: TMLPrecision) async {
        guard let share, option != share.chosenPrecision else { return }
        error = nil
        if option == .precise, !access.authorization.precise {
            let answer = await access.requestPreciseOnce()
            guard answer.precise else {
                prompt = .preciseOff
                return
            }
        }
        do {
            try await sharing.changePrecision(to: option)
        } catch {
            self.error = error
        }
    }

    /// The Precise Location alert's Open Settings.
    public func openSettings() -> URL? {
        prompt = nil
        return access.settingsURL
    }

    /// Send link again: the share sheet with the same link.
    public func sendAgain() {
        guard let share else { return }
        shareSheet = ShareLinkMessage(url: share.link.url, sharerName: sharerName(),
                                       duringCall: ShareFeatures.liveTogether && share.callActive)
    }

    /// The share sheet closed. Nothing changes for the share either way; copying says so.
    public func shareSheetClosed(_ outcome: ShareSheetOutcome) {
        shareSheet = nil
        if outcome == .sent(copied: true) { linkCopied() }
    }

    /// The link went to the clipboard: say so for a moment.
    public func linkCopied() {
        show(toast: "Link copied. Paste it wherever you like.")
    }

    /// Stop sharing: the confirmation first.
    public func requestStop() {
        guard share != nil else { return }
        isConfirmingStop = true
    }

    /// The confirmation's Stop. The ended screen follows from the share's state.
    public func confirmStop() async {
        isConfirmingStop = false
        guard share != nil, !isStopping else { return }
        isStopping = true
        await sharing.stop()
        isStopping = false
    }

    // MARK: Alerts after the first link

    /// Right after the first link goes out: offer alerts, if they've never been asked for.
    public func linkWasSent() async {
        await permissions.refresh()
        guard permissions.notifications == .notSet else { return }
        notificationsPrompt = NotificationsPrompt(viewerName: share?.viewerName)
    }

    /// The explainer's Turn on alerts: the system prompt.
    public func turnOnAlerts() async {
        notificationsPrompt = nil
        await permissions.requestNotifications()
    }

    // MARK: Toast

    /// Shows `text` for 4 seconds; a newer one replaces it.
    func show(toast text: String, for duration: Duration = .seconds(4)) {
        toastID += 1
        let id = toastID
        toast = text
        Task { [weak self] in
            try? await Task.sleep(for: duration)
            guard let self, self.toastID == id else { return }
            self.toast = nil
        }
    }

    /// Hides the toast now (tests, and a tap on it).
    public func dismissToast() {
        toastID += 1
        toast = nil
    }
}

/// The alerts explainer after the first link (prototype `notifPre`): "Know when Mom opens it".
public struct NotificationsPrompt: Hashable, Sendable, Identifiable {
    public let title: String
    public let message: String
    public let confirmTitle = "Turn on alerts"
    public let cancelTitle = "Not now"
    public let systemImage = "bell.fill"
    public var id: String { title }

    public init(viewerName: String?) {
        let audience = ShareAudience(viewerName)
        title = audience.name.map { "Know when \(PersonName.isolated($0)) opens it" } ?? "Know when your link is opened"
        message = PermissionPrompt.notificationsExplainer.message
    }
}
