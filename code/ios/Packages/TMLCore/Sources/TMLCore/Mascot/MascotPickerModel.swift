import Foundation
import Observation

/// The mascot picker (prototype `viewPicker`): a draft look the person edits, saved to the profile
/// with Save (from the Mascot tab) or Continue (the step after sign-up).
///
/// The draft is always a valid look: picking a character drops an accessory it can't wear, as the
/// server requires. While a share is running, the session keeps the look it started with, and the
/// picker says the new one shows from the next share.
@MainActor
@Observable
public final class MascotPickerModel {
    public enum Mode: Hashable, Sendable {
        /// The Mascot tab: Save, pinned above the tab bar, once something changed.
        case tab
        /// The step after sign-up: Continue at the end, which saves whatever is chosen.
        case onboarding
    }

    public let mode: Mode
    /// The look on the profile.
    public private(set) var saved: MascotLook
    /// The look on screen.
    public private(set) var draft: MascotLook
    /// A share is running (its marker keeps the look it started with).
    public var isSharing: Bool
    public private(set) var isSaving = false
    /// Why the last save failed, shown by the button until the next change or try.
    public private(set) var error: ProfileError?
    /// Counts successful saves, to trigger feedback.
    public private(set) var saveCount = 0

    @ObservationIgnored private let profile: any ProfileService
    @ObservationIgnored private let onFinished: @MainActor () -> Void
    /// The set the person switched to, if they did.
    private var chosenSet: TMLMascotSet?

    public init(look: MascotLook, isSharing: Bool, profile: any ProfileService, mode: Mode,
                onFinished: @escaping @MainActor () -> Void = {}) {
        self.saved = look
        self.draft = look
        self.isSharing = isSharing
        self.profile = profile
        self.mode = mode
        self.onFinished = onFinished
    }

    // MARK: What the screen shows

    /// The set whose characters show. It follows the chosen character until the person picks a set.
    public var browsingSet: TMLMascotSet {
        get { chosenSet ?? draft.mascot.set }
        set { chosenSet = newValue }
    }

    /// The four characters in the set on show.
    public var mascots: [TMLMascotId] { browsingSet.mascots }

    /// None, then the accessories the character takes; empty when it takes none.
    public var accessoryOptions: [TMLMascotAccessory?] {
        let accessories = draft.availableAccessories
        return accessories.isEmpty ? [] : [nil] + accessories.map(Optional.some)
    }

    /// Said in place of the accessory choices when there are none.
    public var accessoryNote: String? { draft.mascot.noAccessoriesNote }

    /// "Your new mascot shows from your next share." while sharing.
    public var nextShareNote: String? {
        isSharing ? "Your new mascot shows from your next share." : nil
    }

    public var hasChanges: Bool { draft != saved }

    /// Save needs a change; Continue always works.
    public var canSave: Bool { !isSaving && (mode == .onboarding || hasChanges) }

    public var actionTitle: String { mode == .tab ? "Save" : "Continue" }

    // MARK: Choosing

    public func choose(_ mascot: TMLMascotId) {
        draft.mascot = mascot
        error = nil
    }

    public func choose(_ color: TMLMascotColor) {
        draft.color = color
        error = nil
    }

    /// Nil is none. An accessory the character can't wear is ignored.
    public func choose(accessory: TMLMascotAccessory?) {
        guard TMLMascotCatalog.takes(draft.mascot, accessory) else { return }
        draft.accessory = accessory
        error = nil
    }

    // MARK: Saving

    /// Saves the draft to the profile. True when it saved; on failure, `error` says why and the
    /// draft stays as it was, so trying again sends the same look.
    @discardableResult
    public func save() async -> Bool {
        guard canSave else { return false }
        let look = draft
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await profile.save(mascot: look.mascot, color: look.color, accessory: look.accessory)
        } catch {
            self.error = error
            return false
        }
        saved = look
        saveCount += 1
        onFinished()
        return true
    }

    /// The profile changed (this phone's save, or another device). An untouched draft follows it;
    /// one with changes keeps them.
    public func profileDidChange(_ user: TMLUser) {
        let look = MascotLook(user: user)
        let untouched = !hasChanges
        saved = look
        if untouched && !isSaving { draft = look }
    }
}
