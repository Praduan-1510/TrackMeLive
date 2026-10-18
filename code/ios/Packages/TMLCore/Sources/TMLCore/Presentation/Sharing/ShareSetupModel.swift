import Foundation
import Observation

/// The timer sheet: its title, the choices on offer with the chosen one marked, and the line
/// under them (prototype `topAlex` › timer).
public struct TimerSheetPresentation: Equatable, Sendable {
    public struct Choice: Equatable, Sendable, Identifiable {
        public let choice: StopChoice
        public let label: String
        public let isSelected: Bool
        public var id: String { choice.id }
    }

    public let title: String
    public let choices: [Choice]
    public let footer: String

    public init(choices: [StopChoice], selected: StopChoice, expiresAt: Date?, callOffered: Bool,
                locale: Locale = .current, timeZone: TimeZone = .current) {
        title = "When sharing stops"
        self.choices = choices.map {
            Choice(choice: $0, label: $0.label(expiresAt: expiresAt, locale: locale, timeZone: timeZone),
                   isSelected: $0 == selected)
        }
        footer = "Sharing never runs longer than 1 hour."
            + (callOffered ? " If the call drops and you\u{2019}ve set a timer, sharing continues until it runs out." : "")
    }
}

/// The share screen (FSD §4 Live map link, Who it's for, Stop rule, Location detail, Let them share
/// back; prototype `viewShare`): who it's for, when it stops, how precise, then Share live location,
/// which creates the session and hands its link to the system share sheet.
///
/// - The name starts with the last one used and keeps typing to 24 characters. Only the sharer
///   sees it; it's sent tidied, or not at all when empty.
/// - Stops starts from Settings' default: the call during a call, otherwise 30 minutes for a call
///   default (FSD §4 Stop rule).
/// - Location starts from Settings' Location detail, Approximate while Precise Location is off for
///   the app. Picking Precise then asks for the system's one-time precise access (FSD §8); if it
///   stays off, an alert explains how to turn it on in Settings.
/// - If the share sheet closes without a choice, the session is discarded before anyone sees it.
@MainActor
@Observable
public final class ShareSetupModel {
    /// Who it's for, as typed.
    public var viewerName: String {
        didSet {
            let limited = PersonName.limitTyping(viewerName)
            if limited != viewerName { viewerName = limited }
        }
    }
    public private(set) var stop: StopChoice
    public private(set) var precision: TMLPrecision
    /// Let them share back (only during a call; a Sprint 3 seam).
    public var shareBack: Bool
    /// A call is connected (a Sprint 3 seam: always false for now).
    public let onCall: Bool

    /// The timer sheet is up.
    public var isChoosingStop = false
    /// The Precise Location alert, when the one-time request leaves it off.
    public var prompt: LocationPrompt?
    /// `createSession` is on its way, or the share sheet is up.
    public private(set) var isStarting = false
    /// Why the last Share didn't work, said under the button.
    public private(set) var error: SharingError?
    /// The share sheet's content while it's up.
    public var shareSheet: ShareLinkMessage?

    @ObservationIgnored public let sharerName: String
    @ObservationIgnored private let sharing: any SharingService
    @ObservationIgnored private let access: any LocationAccess
    @ObservationIgnored private let onShared: @MainActor (_ copied: Bool) -> Void

    /// - Parameters:
    ///   - gatePrecision: what the location gate allows (Approximate while Precise Location is off).
    ///   - onShared: the link went out; the live screen comes next.
    public init(settings: TMLUserSettings, lastViewerName: String?, sharerName: String, gatePrecision: TMLPrecision,
                sharing: any SharingService, access: any LocationAccess, onCall: Bool = false,
                onShared: @escaping @MainActor (_ copied: Bool) -> Void) {
        self.viewerName = PersonName.limitTyping(lastViewerName ?? "")
        self.onCall = onCall
        self.stop = StopChoice(defaultStop: settings.defaultStop, onCall: onCall)
        self.precision = gatePrecision
        self.shareBack = settings.shareBack
        self.sharerName = sharerName
        self.sharing = sharing
        self.access = access
        self.onShared = onShared
    }

    // MARK: What the screen shows

    /// "The person you're talking to follows you…" during a call, otherwise "Whoever gets the link…".
    public var lede: String {
        onCall
            ? "The person you\u{2019}re talking to follows you live in their browser. No app needed."
            : "Whoever gets the link follows you live in their browser. No app needed."
    }

    /// Live Together is on offer: during a call with share back on.
    public var showsTogether: Bool { ShareFeatures.liveTogether && onCall && shareBack }

    /// The preview's caption beside its badge.
    public var previewCaption: String { showsTogether ? "You both see one map" : "They see you move as you go" }

    /// The ghost marker's name on the preview, during a call.
    public var previewViewerName: String { ShareAudience(viewerName).label }

    /// The share-back switch shows only during a call.
    public var showsShareBack: Bool { ShareFeatures.liveTogether && onCall }

    /// The Stops row's value.
    public var stopLabel: String { stop.label(expiresAt: nil) }

    /// The clear button shows once there's a name.
    public var canClearName: Bool { !PersonName.tidy(viewerName).isEmpty }

    /// iOS gives the app only approximate locations.
    public var isPreciseOff: Bool { !access.authorization.precise }

    /// The Location menu's line under each choice.
    public func precisionDetail(_ option: TMLPrecision) -> String {
        switch option {
        case .precise: isPreciseOff ? "Precise is off in Settings" : "Your exact spot"
        case .approximate: "Within about 500 m"
        }
    }

    public var timerSheet: TimerSheetPresentation {
        TimerSheetPresentation(choices: StopChoice.beforeSharing(onCall: onCall), selected: stop, expiresAt: nil,
                               callOffered: onCall)
    }

    // MARK: Changes

    public func clearViewerName() { viewerName = "" }

    public func choose(stop choice: StopChoice) {
        isChoosingStop = false
        guard StopChoice.beforeSharing(onCall: onCall).contains(choice) else { return }
        stop = choice
    }

    /// Precise or Approximate for this share. Precise while it's off for the app asks for the
    /// system's one-time precise access first.
    public func choose(precision option: TMLPrecision) async {
        guard option == .precise, isPreciseOff else {
            precision = option
            return
        }
        let answer = await access.requestPreciseOnce()
        if answer.precise {
            precision = .precise
        } else {
            precision = .approximate
            prompt = .preciseOff
        }
    }

    /// The Precise Location alert's Open Settings.
    public func openSettings() -> URL? {
        prompt = nil
        return access.settingsURL
    }

    // MARK: Sharing

    /// Share live location: creates the session and puts its link in the share sheet.
    public func share() async {
        guard !isStarting else { return }
        isStarting = true
        error = nil
        let options = ShareOptions(
            viewerName: PersonName.tidy(viewerName).isEmpty ? nil : viewerName,
            stop: stop,
            callId: nil,
            shareBack: showsShareBack && shareBack,
            // Never more precise than iOS allows right now.
            precision: isPreciseOff ? .approximate : precision
        )
        do {
            let link = try await sharing.start(options)
            shareSheet = ShareLinkMessage(url: link.url, sharerName: sharerName, duringCall: onCall)
        } catch {
            isStarting = false
            if case .alreadySharing = error, sharing.state.isActive {
                // A share is already running (another screen started it): show that one.
                onShared(false)
                return
            }
            self.error = error
        }
    }

    /// The share sheet closed. Sent (Copy link counts) goes on to the live screen; otherwise the
    /// session is discarded and the screen stays as it was, ready to try again.
    public func shareSheetClosed(_ outcome: ShareSheetOutcome) async {
        shareSheet = nil
        switch outcome {
        case .sent(let copied):
            isStarting = false
            onShared(copied)
        case .cancelled:
            do {
                try await sharing.discard()
                isStarting = false
            } catch .linkOpened {
                // The link was opened meanwhile (Copy link, then a paste), so the share carries on.
                isStarting = false
                onShared(false)
            } catch {
                isStarting = false
                self.error = error
            }
        }
    }
}
