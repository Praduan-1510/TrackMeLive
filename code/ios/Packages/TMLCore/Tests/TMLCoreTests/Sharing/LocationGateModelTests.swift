import Foundation
import Testing
@testable import TMLCore

/// What `LocationGateModel` handed on, if anything.
@MainActor
final class ReadyRecorder {
    private(set) var calls: [(precision: TMLPrecision, offerPrecise: Bool)] = []
    var precisions: [TMLPrecision] { calls.map(\.precision) }
    func record(_ precision: TMLPrecision, _ offerPrecise: Bool) { calls.append((precision, offerPrecise)) }
}

@MainActor
@Suite("Location before sharing")
struct LocationGateModelTests {
    let ready = ReadyRecorder()

    func begin(_ access: FakeLocationAccess, wanting precision: TMLPrecision = .precise) async -> LocationGateModel {
        let gate = LocationGateModel(access: access)
        await gate.begin(wanting: precision, ready: ready.record)
        return gate
    }

    @Test func allowedGoesStraightOn() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, hasAsked: true))
        let gate = await begin(access)
        #expect(gate.prompt == nil)
        #expect(ready.precisions == [.precise])
        #expect(access.requests.isEmpty)
    }

    @Test func approximateWantedStaysApproximate() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .always, hasAsked: true))
        _ = await begin(access, wanting: .approximate)
        #expect(ready.precisions == [.approximate])
    }

    @Test func preciseOffSharesApproximateAndOffersTheOneTimeRequest() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, precise: false, hasAsked: true))
        _ = await begin(access)
        #expect(ready.calls.count == 1)
        #expect(ready.calls.first?.precision == .approximate && ready.calls.first?.offerPrecise == true)
    }

    @Test func neverAskedShowsTheExplainerFirst() async {
        let access = FakeLocationAccess()
        let gate = await begin(access)
        #expect(gate.prompt == .explainer)
        #expect(gate.prompt?.title == "Allow location to share")
        #expect(gate.prompt?.confirmTitle == "Continue" && gate.prompt?.cancelTitle == "Not now")
        #expect(access.requests.isEmpty)
        #expect(ready.calls.isEmpty)
    }

    @Test func continueAsksTheSystemAndAllowedGoesOn() async {
        let access = FakeLocationAccess()
        let gate = await begin(access)
        await gate.continueFromExplainer()
        #expect(access.requests == ["whenInUse"])
        #expect(gate.prompt == nil && !gate.isAsking)
        #expect(ready.precisions == [.precise])
    }

    @Test func continueThenPreciseOffGoesOnApproximate() async {
        let access = FakeLocationAccess(grantsPrecise: false)
        let gate = await begin(access)
        await gate.continueFromExplainer()
        #expect(ready.precisions == [.approximate])
    }

    @Test func continueThenDontAllowExplainsSettings() async {
        let access = FakeLocationAccess(answer: .denied)
        let gate = await begin(access)
        await gate.continueFromExplainer()
        #expect(gate.prompt == .turnOn(servicesOff: false))
        #expect(gate.prompt?.title == "Location is off for Track Me Live")
        #expect(gate.prompt?.message == "To share where you are, turn on location in Settings. It\u{2019}s only used while you share.")
        #expect(gate.prompt?.confirmTitle == "Open Settings")
        #expect(ready.calls.isEmpty)
    }

    @Test func askNextTimeGoesStraightToTheSystemPrompt() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .notDetermined, hasAsked: true))
        let gate = await begin(access)
        #expect(access.requests == ["whenInUse"])
        #expect(gate.prompt == nil)
        #expect(ready.precisions == [.precise])
    }

    @Test func aPromptDismissedWithoutAnAnswerSaysNothing() async {
        // The system prompt went away undecided (the app went to the background): still not determined.
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .notDetermined, hasAsked: true),
                                        answer: .notDetermined)
        let gate = await begin(access)
        #expect(access.requests == ["whenInUse"])
        #expect(gate.prompt == nil)
        #expect(ready.calls.isEmpty)
    }

    @Test func deniedExplainsSettings() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .denied, hasAsked: true))
        let gate = await begin(access)
        #expect(gate.prompt == .turnOn(servicesOff: false))
        #expect(access.requests.isEmpty)
    }

    @Test func locationServicesOffForThePhoneSaysWhere() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .whenInUse, servicesEnabled: false))
        let gate = await begin(access)
        #expect(gate.prompt == .turnOn(servicesOff: true))
        #expect(gate.prompt?.title == "Location Services is off")
        #expect(gate.prompt?.message.contains("Privacy & Security") == true)
        #expect(gate.prompt?.confirmTitle == "Open Settings")
    }

    @Test func restrictedSaysWhoCanChangeItAndOffersOnlyOK() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .restricted))
        let gate = await begin(access)
        #expect(gate.prompt == .restricted)
        #expect(gate.prompt?.title == "Location isn\u{2019}t allowed on this iPhone")
        #expect(gate.prompt?.message.contains("Screen Time") == true)
        #expect(gate.prompt?.confirmTitle == nil)
        #expect(gate.prompt?.cancelTitle == "OK")
        #expect(gate.prompt?.isExplainer == false)
    }

    @Test func notNowAsksNothingAndSharesNothing() async {
        let access = FakeLocationAccess()
        let gate = await begin(access)
        gate.dismiss()
        #expect(gate.prompt == nil)
        await gate.appDidBecomeActive()
        #expect(access.requests.isEmpty && ready.calls.isEmpty)
    }

    @Test func backFromSettingsWithLocationOnCarriesOn() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .denied, hasAsked: true))
        let gate = await begin(access)
        #expect(gate.openSettings() == access.settingsURL)
        #expect(gate.prompt == nil && gate.isWaitingForSettings)
        access.authorization = LocationAuthorization(status: .whenInUse, hasAsked: true)
        await gate.appDidBecomeActive()
        #expect(ready.precisions == [.precise])
        #expect(!gate.isWaitingForSettings)
        // Coming back again doesn't start a second share.
        await gate.appDidBecomeActive()
        #expect(ready.calls.count == 1)
    }

    @Test func backFromSettingsStillOffAsksNothingMore() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .denied, hasAsked: true))
        let gate = await begin(access)
        _ = gate.openSettings()
        await gate.appDidBecomeActive()
        #expect(gate.prompt == nil && ready.calls.isEmpty)
        access.authorization = LocationAuthorization(status: .whenInUse, hasAsked: true)
        await gate.appDidBecomeActive()
        #expect(ready.calls.isEmpty)
    }

    @Test func anotherShareTapReplacesAWaitingOne() async {
        let access = FakeLocationAccess(authorization: LocationAuthorization(status: .denied, hasAsked: true))
        let gate = await begin(access)
        _ = gate.openSettings()
        access.authorization = LocationAuthorization(status: .whenInUse, hasAsked: true)
        await gate.begin(wanting: .approximate, ready: ready.record)
        #expect(ready.precisions == [.approximate])
        await gate.appDidBecomeActive()
        #expect(ready.calls.count == 1)
    }

    @Test func promptIDsAreDistinct() {
        let all: [LocationPrompt] = [.explainer, .turnOn(servicesOff: false), .turnOn(servicesOff: true), .restricted, .preciseOff]
        #expect(Set(all.map(\.id)).count == all.count)
        #expect(LocationPrompt.preciseOff.title == "Precise Location is off")
        #expect(LocationPrompt.preciseOff.confirmTitle == "Open Settings")
        #expect(LocationPrompt.explainer.isExplainer)
    }
}
