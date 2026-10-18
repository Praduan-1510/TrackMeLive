import Foundation
import Testing
@testable import TMLCore

@MainActor
@Suite("Mascot picker")
struct MascotPickerModelTests {
    let service = FakeProfileService()

    func model(_ look: MascotLook = .default, mode: MascotPickerModel.Mode = .tab, sharing: Bool = false,
               onFinished: @escaping @MainActor () -> Void = {}) -> MascotPickerModel {
        MascotPickerModel(look: look, isSharing: sharing, profile: service, mode: mode, onFinished: onFinished)
    }

    static func user(_ look: MascotLook) -> TMLUser {
        TMLUser(name: "Alex", mascotId: look.mascot, mascotColor: look.color, mascotAccessory: look.accessory,
                settings: .defaults, createdAt: .distantPast, updatedAt: .distantPast)
    }

    /// The set tab follows the chosen mascot until someone switches sets (prototype `pickSet`).
    @Test func theSetFollowsTheChosenMascotUntilThePersonPicksOne() {
        let m = model(MascotLook(mascot: .ninja))
        #expect(m.browsingSet == .anime)
        #expect(m.mascots == [.hero, .star, .ninja, .neko])
        m.browsingSet = .movie
        m.choose(.agent)
        m.choose(.fox)
        #expect(m.browsingSet == .movie) // the person's choice of set stays
        #expect(m.draft.mascot == .fox)
    }

    @Test func pickingACharacterDropsAnAccessoryItCantWear() {
        let m = model(MascotLook(mascot: .fox, color: .rose, accessory: .glasses))
        m.choose(.robot)
        #expect(m.draft == MascotLook(mascot: .robot, color: .rose, accessory: nil))
        m.choose(accessory: .glasses) // the robot takes only the headlamp
        #expect(m.draft.accessory == nil)
        m.choose(accessory: .headlamp)
        #expect(m.draft.accessory == .headlamp)
    }

    @Test func accessoryChoicesAreNoneThenWhatTheCharacterTakes() {
        let m = model()
        #expect(m.accessoryOptions == [nil, .headphones, .glasses, .headlamp])
        #expect(m.accessoryNote == nil)
        m.choose(.astronaut)
        #expect(m.accessoryOptions.isEmpty)
        #expect(m.accessoryNote == "The astronaut\u{2019}s helmet doesn\u{2019}t take accessories.")
    }

    @Test func saveNeedsAChangeFromTheTab() async {
        var finished = 0
        let m = model(onFinished: { finished += 1 })
        #expect(m.actionTitle == "Save")
        #expect(!m.canSave)
        #expect(await m.save() == false)
        #expect(service.calls.isEmpty)

        m.choose(.lagoon)
        m.choose(accessory: .headphones)
        #expect(m.canSave)
        #expect(await m.save())
        #expect(service.calls == [.mascot(.fox, .lagoon, .headphones)])
        #expect(m.saved == m.draft && !m.hasChanges && !m.canSave)
        #expect(m.saveCount == 1 && finished == 1)
        #expect(!m.isSaving)
    }

    @Test func continueAlwaysSavesDuringOnboarding() async {
        var finished = false
        let m = model(mode: .onboarding, onFinished: { finished = true })
        #expect(m.actionTitle == "Continue")
        #expect(m.canSave)
        #expect(await m.save())
        #expect(service.calls == [.mascot(.fox, .original, nil)])
        #expect(finished)
    }

    @Test func aFailedSaveKeepsTheDraftAndSaysWhy() async {
        var finished = false
        let m = model(onFinished: { finished = true })
        m.choose(.ghost)
        service.nextError = .offline
        #expect(await m.save() == false)
        #expect(m.error == .offline)
        #expect(m.draft.mascot == .ghost && m.saved == .default && m.hasChanges)
        #expect(!finished)
        m.choose(.dusk)
        #expect(m.error == nil) // a new change clears the old message
        #expect(await m.save())
        #expect(service.calls.last == .mascot(.ghost, .dusk, nil))
    }

    @Test func saysTheNewLookShowsFromTheNextShareWhileSharing() {
        let m = model(sharing: true)
        #expect(m.nextShareNote == "Your new mascot shows from your next share.")
        m.isSharing = false
        #expect(m.nextShareNote == nil)
    }

    /// Another device changed the profile: an untouched picker follows; edits in progress stay.
    @Test func profileChangesReachAnUntouchedDraftOnly() {
        let m = model()
        m.profileDidChange(Self.user(MascotLook(mascot: .cowboy, color: .moss, accessory: .glasses)))
        #expect(m.draft == MascotLook(mascot: .cowboy, color: .moss, accessory: .glasses))
        #expect(m.browsingSet == .movie)
        m.choose(.star)
        m.profileDidChange(Self.user(MascotLook(mascot: .ace)))
        #expect(m.saved.mascot == .ace)
        #expect(m.draft.mascot == .star && m.hasChanges)
    }
}
