import Foundation
import Observation

/// What the share flow says about location before the share screen (FSD §8; prototype
/// `permPrompt`): the explainer before the system prompt, and the alerts for location that's off,
/// restricted, or approximate when Precise was wanted.
public enum LocationPrompt: Hashable, Sendable, Identifiable {
    /// Never asked: what location is for, then Continue shows the system prompt.
    case explainer
    /// Off for the app, or Location Services is off for the whole phone.
    case turnOn(servicesOff: Bool)
    /// Screen Time or a device profile blocks it; only whoever manages the iPhone can change it.
    case restricted
    /// Precise Location is off for the app and the one-time request didn't turn it on.
    case preciseOff

    public var id: String {
        switch self {
        case .explainer: "explainer"
        case .turnOn(let servicesOff): servicesOff ? "services-off" : "location-off"
        case .restricted: "restricted"
        case .preciseOff: "precise-off"
        }
    }

    /// The explainer is a sheet with a picture; the rest are alerts.
    public var isExplainer: Bool { self == .explainer }

    public var title: String {
        switch self {
        case .explainer: PermissionPrompt.locationExplainer.title
        case .turnOn(servicesOff: false): PermissionPrompt.locationOff.title
        case .turnOn(servicesOff: true): "Location Services is off"
        case .restricted: "Location isn\u{2019}t allowed on this iPhone"
        case .preciseOff: "Precise Location is off"
        }
    }

    public var message: String {
        switch self {
        case .explainer:
            PermissionPrompt.locationExplainer.message
        case .turnOn(servicesOff: false):
            PermissionPrompt.locationOff.message
        case .turnOn(servicesOff: true):
            "To share where you are, turn on Location Services in Settings, under Privacy & Security. "
                + "Track Me Live only uses it while you share."
        case .restricted:
            "Screen Time or a profile on this iPhone doesn\u{2019}t allow Track Me Live to use location. "
                + "Whoever manages this iPhone can allow it in Settings, under Screen Time."
        case .preciseOff:
            "To share your exact spot, turn on Precise Location for Track Me Live in Settings. "
                + "Until then, shares are approximate."
        }
    }

    /// The prominent action, or nil when there's nothing the app can open (restricted).
    public var confirmTitle: String? {
        switch self {
        case .explainer: "Continue"
        case .turnOn, .preciseOff: "Open Settings"
        case .restricted: nil
        }
    }

    /// "Not now", or "OK" when it's the only button.
    public var cancelTitle: String { self == .restricted ? "OK" : "Not now" }
}

/// The location step of the share flow (FSD §8): location is asked for on the first share, never at
/// install, with the explainer first. Once it's allowed, `onReady` gets the precision the share can
/// use (Approximate while Precise Location is off for the app) and whether to offer the one-time
/// precise request.
///
/// Opening Settings from an alert remembers the share: when the app comes back with location on,
/// the share carries on to the share screen, as in the prototype.
@MainActor
@Observable
public final class LocationGateModel {
    /// The explainer or alert on screen.
    public var prompt: LocationPrompt?
    /// The system prompt is up (or being asked for).
    public private(set) var isAsking = false

    @ObservationIgnored public let access: any LocationAccess
    @ObservationIgnored private var wanted: TMLPrecision = .precise
    @ObservationIgnored private var onReady: (@MainActor (TMLPrecision, Bool) -> Void)?
    /// A share is waiting for the person to come back from Settings.
    @ObservationIgnored private(set) var isWaitingForSettings = false

    public init(access: any LocationAccess) {
        self.access = access
    }

    /// Share live location was tapped. Calls `ready` at once when location is allowed; otherwise
    /// shows the explainer, the system prompt or the right alert, and calls `ready` once it is.
    public func begin(wanting precision: TMLPrecision, ready: @escaping @MainActor (TMLPrecision, Bool) -> Void) async {
        wanted = precision
        onReady = ready
        isWaitingForSettings = false
        await advance(access.authorization.gate(wanting: precision))
    }

    /// The explainer's Continue: the system prompt.
    public func continueFromExplainer() async {
        prompt = nil
        await askSystem()
    }

    /// Not now, OK, or a swipe down: nothing is asked and nothing is shared.
    public func dismiss() {
        prompt = nil
        onReady = nil
        isWaitingForSettings = false
    }

    /// An alert's Open Settings: the URL to open. The share waits for the person to come back.
    public func openSettings() -> URL? {
        prompt = nil
        isWaitingForSettings = onReady != nil
        return access.settingsURL
    }

    /// The app is active again (back from Settings): carries on if location is on now. A share
    /// left in Settings with location still off asks nothing more until it's tapped again.
    public func appDidBecomeActive() async {
        guard isWaitingForSettings else { return }
        isWaitingForSettings = false
        await access.refresh()
        let gate = access.authorization.gate(wanting: wanted)
        if case .ready = gate { await advance(gate) } else { onReady = nil }
    }

    private func askSystem() async {
        isAsking = true
        let answer = await access.requestWhenInUse()
        isAsking = false
        switch answer.gate(wanting: wanted) {
        case .ready(let precision, let offerPrecise):
            finish(precision, offerPrecise)
        case .explain, .ask:
            // Dismissed without an answer (the app went to the background): nothing to say.
            onReady = nil
        case let other:
            await advance(other)
        }
    }

    private func advance(_ gate: LocationGate) async {
        switch gate {
        case .explain: prompt = .explainer
        case .ask: await askSystem()
        case .turnOnInSettings(let servicesOff): prompt = .turnOn(servicesOff: servicesOff)
        case .restricted: prompt = .restricted
        case .ready(let precision, let offerPrecise): finish(precision, offerPrecise)
        }
    }

    private func finish(_ precision: TMLPrecision, _ offerPrecise: Bool) {
        let ready = onReady
        onReady = nil
        prompt = nil
        ready?(precision, offerPrecise)
    }
}
