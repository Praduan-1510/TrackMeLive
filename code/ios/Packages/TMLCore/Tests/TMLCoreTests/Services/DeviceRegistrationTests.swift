import Foundation
import Testing
@testable import TMLCore

@MainActor
@Suite("Device registration (Backend-Alerts' device contract)")
struct DeviceRegistrationTests {
    @Test func theDeviceIdIsMadeOncePerInstall() throws {
        let scratch = try ScratchDefaults()
        let first = DeviceRegistrar(backend: FakePushTokens(), defaults: scratch.defaults)
        let again = DeviceRegistrar(backend: FakePushTokens(), defaults: scratch.defaults)
        #expect(UUID(uuidString: first.deviceId) != nil)
        #expect(again.deviceId == first.deviceId)
        let other = try ScratchDefaults()
        #expect(DeviceRegistrar(backend: FakePushTokens(), defaults: other.defaults).deviceId != first.deviceId)
    }

    @Test func aReadyProfileWritesTheDocThenEachNewToken() async throws {
        let scratch = try ScratchDefaults()
        let tokens = FakePushTokens(token: "fcm-1")
        let registrar = DeviceRegistrar(backend: tokens, defaults: scratch.defaults)
        registrar.profileReady(uid: "alex")
        #expect(await eventually { tokens.saves.count == 1 })
        #expect(tokens.saves[0] == .init(uid: "alex", deviceId: registrar.deviceId, pushToken: "fcm-1"))
        // The same token again (FCM's once-per-launch callback) isn't written twice.
        tokens.refresh(to: "fcm-1")
        tokens.refresh(to: "fcm-2")
        #expect(await eventually { tokens.saves.count == 2 })
        #expect(tokens.saves[1].pushToken == "fcm-2")
        // Asking again for the same account does nothing new.
        registrar.profileReady(uid: "alex")
        await ManualShareClock.settle()
        #expect(tokens.saves.count == 2)
    }

    @Test func noTokenYetMeansNoDocYetAndNothingBreaks() async throws {
        let scratch = try ScratchDefaults()
        let tokens = FakePushTokens(token: nil)
        let registrar = DeviceRegistrar(backend: tokens, defaults: scratch.defaults)
        registrar.profileReady(uid: "alex")
        await ManualShareClock.settle()
        #expect(tokens.saves.isEmpty)
        // The token arrives later (APNs registered).
        tokens.refresh(to: "fcm-late")
        #expect(await eventually { tokens.saves.count == 1 })
    }

    @Test func aFailedWriteWaitsForTheNextToken() async throws {
        let scratch = try ScratchDefaults()
        let tokens = FakePushTokens(token: "fcm-1")
        tokens.nextSaveError = .offline
        let registrar = DeviceRegistrar(backend: tokens, defaults: scratch.defaults)
        registrar.profileReady(uid: "alex")
        await ManualShareClock.settle()
        #expect(tokens.saves.isEmpty)
        #expect(registrar.saved == nil)
        tokens.refresh(to: "fcm-1")
        #expect(await eventually { tokens.saves.count == 1 })
    }

    @Test func signingOutDeletesTheDocFirstAndStopsListening() async throws {
        let scratch = try ScratchDefaults()
        let tokens = FakePushTokens(token: "fcm-1")
        let registrar = DeviceRegistrar(backend: tokens, defaults: scratch.defaults)
        registrar.profileReady(uid: "alex")
        #expect(await eventually { tokens.saves.count == 1 })
        await registrar.willSignOut()
        #expect(tokens.deletes == ["alex/\(registrar.deviceId)"])
        #expect(await eventually { tokens.listeners == 0 })
        tokens.refresh(to: "fcm-2")
        await ManualShareClock.settle()
        #expect(tokens.saves.count == 1)
        // Signed out already: nothing to delete.
        await registrar.willSignOut()
        #expect(tokens.deletes.count == 1)
    }

    @Test func anotherAccountGetsItsOwnDoc() async throws {
        let scratch = try ScratchDefaults()
        let tokens = FakePushTokens(token: "fcm-1")
        let registrar = DeviceRegistrar(backend: tokens, defaults: scratch.defaults)
        registrar.profileReady(uid: "alex")
        #expect(await eventually { tokens.saves.count == 1 })
        registrar.stop()
        registrar.profileReady(uid: "sam")
        #expect(await eventually { tokens.saves.count == 2 })
        #expect(tokens.saves[1].uid == "sam")
    }

    @Test func linkOpenedAlertsParseAndRouteToTheirShare() {
        let alert = PushAlert(userInfo: ["type": "link_opened", "session_id": "s1", "aps": ["alert": "Mom opened your link"]])
        #expect(alert == .linkOpened(sessionId: "s1"))
        #expect(alert?.opensLive(activeSessionId: "s1") == true)
        #expect(alert?.opensLive(activeSessionId: "s2") == false)
        #expect(alert?.opensLive(activeSessionId: nil) == false)
        #expect(PushAlert(userInfo: ["type": "something_new", "session_id": "s1"]) == nil)
        #expect(PushAlert(userInfo: ["type": "link_opened"]) == nil)
        #expect(PushAlert(userInfo: ["type": "link_opened", "session_id": ""]) == nil)
        #expect(PushAlert(userInfo: [:]) == nil)
    }
}
