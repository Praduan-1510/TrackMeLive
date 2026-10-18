import CoreLocation
import Foundation
import Testing
import UserNotifications
@testable import TMLCore

@Suite("Permissions")
struct PermissionTests {
    /// iOS says "not determined" before the first ask and again after Allow Once or Ask Next Time.
    @Test func notDeterminedMeansNotSetOnlyBeforeTheFirstAsk() {
        #expect(LocationPermission(status: .notDetermined, accuracy: .fullAccuracy, hasAsked: false) == .notSet)
        #expect(LocationPermission(status: .notDetermined, accuracy: .fullAccuracy, hasAsked: true) == .askNextTime)
    }

    @Test func mapsTheSystemLocationStates() throws {
        // `.authorizedWhenInUse` is unavailable to macOS code, where these tests run; it's raw value 4.
        let whenInUse = try #require(CLAuthorizationStatus(rawValue: 4))
        #expect(LocationPermission(status: whenInUse, accuracy: .fullAccuracy, hasAsked: true) == .whileUsing(precise: true))
        #expect(LocationPermission(status: whenInUse, accuracy: .reducedAccuracy, hasAsked: true) == .whileUsing(precise: false))
        #expect(LocationPermission(status: .authorizedAlways, accuracy: .fullAccuracy, hasAsked: true) == .always(precise: true))
        #expect(LocationPermission(status: .denied, accuracy: .fullAccuracy, hasAsked: true) == .off)
        #expect(LocationPermission(status: .restricted, accuracy: .fullAccuracy, hasAsked: false) == .off)
        #expect(LocationPermission.whileUsing(precise: false).isAllowed)
        #expect(!LocationPermission.askNextTime.isAllowed)
        #expect(LocationPermission.whileUsing(precise: false).preciseLocation == false)
        #expect(LocationPermission.off.preciseLocation == nil)
    }

    @Test func mapsTheSystemNotificationStates() {
        #expect(NotificationPermission(status: .notDetermined) == .notSet)
        #expect(NotificationPermission(status: .authorized) == .allowed)
        #expect(NotificationPermission(status: .provisional) == .allowed)
        #expect(NotificationPermission(status: .denied) == .off)
    }

    /// The prototype's Permissions rows: sentence-case values, Precise under an allowed location,
    /// and no action (so no chevron) once access is allowed.
    @Test func rowsReadAsInThePrototype() {
        let rows: [(PermissionRow, String, String?, PermissionRow.Action?)] = [
            (PermissionRow(.notSet as LocationPermission), "Not set", nil, .explain),
            (PermissionRow(.askNextTime), "Ask next time", nil, .ask),
            (PermissionRow(.whileUsing(precise: true)), "While using the app", "Precise: On", nil),
            (PermissionRow(.whileUsing(precise: false)), "While using the app", "Precise: Off", nil),
            (PermissionRow(.always(precise: true)), "Always", "Precise: On", nil),
            (PermissionRow(.off as LocationPermission), "Off", nil, .openSettings),
            (PermissionRow(.notSet as NotificationPermission), "Not set", nil, .explain),
            (PermissionRow(.allowed), "Allowed", nil, nil),
            (PermissionRow(.off as NotificationPermission), "Off", nil, .openSettings),
        ]
        for (row, value, detail, action) in rows {
            #expect(row.value == value)
            #expect(row.detail == detail)
            #expect(row.action == action)
            #expect((row.hint == nil) == (action == nil))
            // Sentence case: only the first letter is a capital.
            #expect(row.value.dropFirst() == row.value.dropFirst().lowercased())
        }
        #expect(PermissionRow(.off as LocationPermission).title == "Location")
        #expect(PermissionRow(.allowed).title == "Notifications")
    }

    @Test func promptsUseTheAppsVoice() {
        for prompt in [PermissionPrompt.locationExplainer, .notificationsExplainer, .locationOff, .notificationsOff] {
            #expect(!prompt.title.contains("!") && !prompt.message.contains("!"))
            #expect(prompt.cancelTitle == "Not now")
        }
        #expect(PermissionPrompt.locationExplainer.isExplainer && !PermissionPrompt.locationOff.isExplainer)
        #expect(PermissionPrompt.locationOff.confirmTitle == "Open Settings")
    }

    @Test @MainActor func theFixedServiceActsLikeAYes() async {
        let service = FixedPermissionsService()
        await service.requestLocation()
        await service.requestNotifications()
        #expect(service.location == .whileUsing(precise: true))
        #expect(service.notifications == .allowed)
        #expect(service.requests == ["location", "notifications"])
        service.location = .off
        await service.requestLocation()
        #expect(service.location == .off) // iOS won't ask again once it's off
    }
}
