package live.trackme.app.ui.share

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.location.PermissionStatus
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.sharing.CreateShareResult
import live.trackme.app.data.sharing.DiscardShareResult
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.SharingFailure
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.fakes.FakeLocationPermissions
import live.trackme.app.fakes.FakeProfileRepository
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.app.fakes.MainDispatcherRule
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.schema.DefaultStop
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import live.trackme.schema.UserSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Robolectric for android.icu (the name rule). */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class ShareViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private val sharing = FakeSharingRepository()
    private val permissions = FakeLocationPermissions(FakeLocationPermissions.AllGranted)
    private val alex = Profile(
        name = "Alex",
        mascotId = MascotId.NEKO,
        mascotColor = MascotColor.DUSK,
        mascotAccessory = MascotAccessory.GLASSES,
        settings = UserSettings(precision = Precision.PRECISE, defaultStopWire = DefaultStop.CALL.wire),
        lastViewerName = "Mom",
    )
    private val profiles = FakeProfileRepository(ProfileState.Ready(alex))

    private fun TestScope.vm(autoShare: Boolean = false): Pair<ShareViewModel, MutableList<ShareEvent>> {
        val vm = ShareViewModel(sharing, permissions, profiles, autoShare)
        val events = mutableListOf<ShareEvent>()
        backgroundScope.launch { vm.events.toList(events) }
        runCurrent()
        return vm to events
    }

    @Test
    fun startsFromTheProfileAndSettings() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        val s = vm.state.value
        assertEquals("Mom", vm.viewerName)
        assertEquals(MascotLook(MascotId.NEKO, MascotColor.DUSK, MascotAccessory.GLASSES), s.look)
        assertEquals("Alex", s.sharerName)
        // Without a call, a call default is 30 minutes (FSD §4 Stop rule).
        assertEquals(StopChoice.After(StopMinutes.MINUTES_30), s.stop)
        assertEquals(StopChoices.beforeSharing, s.stopOptions)
        assertEquals(Precision.PRECISE, s.precision)
        assertTrue(s.preciseAllowed)
        assertFalse(s.busy)
        assertNull(s.error)
    }

    @Test
    fun otherDefaultsComeThroughAsTheyAre() = runTest(main.dispatcher.scheduler) {
        profiles.profile.value = ProfileState.Ready(
            alex.copy(settings = UserSettings(precision = Precision.APPROXIMATE, defaultStopWire = DefaultStop.MINUTES_60.wire), lastViewerName = null),
        )
        val (vm, _) = vm()
        assertEquals("", vm.viewerName)
        assertEquals(StopChoice.After(StopMinutes.MINUTES_60), vm.state.value.stop)
        assertEquals(Precision.APPROXIMATE, vm.state.value.precision)
    }

    @Test
    fun withOnlyApproximateLocationEveryShareIsApproximate() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(preciseLocation = false)
        val (vm, _) = vm()
        assertEquals(Precision.APPROXIMATE, vm.state.value.precision)
        assertFalse(vm.state.value.preciseAllowed)
    }

    @Test
    fun aNameTypedBeforeTheProfileLoadsIsKept() = runTest(main.dispatcher.scheduler) {
        profiles.profile.value = ProfileState.Loading
        val (vm, _) = vm()
        vm.onViewerNameChange("Dad")
        profiles.profile.value = ProfileState.Ready(alex)
        runCurrent()
        assertEquals("Dad", vm.viewerName)
    }

    @Test
    fun typingStopsAt24CharactersAndClearEmptiesTheField() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        vm.onViewerNameChange("A".repeat(30))
        assertEquals(24, vm.viewerName.length)
        vm.clearViewerName()
        assertEquals("", vm.viewerName)
    }

    @Test
    fun shareCreatesTheSessionThenOpensTheSheetWithItsLink() = runTest(main.dispatcher.scheduler) {
        val (vm, events) = vm()
        vm.onViewerNameChange("  Mom   R  ")
        vm.onStopChange(StopChoice.After(StopMinutes.MINUTES_15))
        vm.onPrecisionChange(Precision.APPROXIMATE)
        vm.share()
        assertTrue(vm.state.value.busy)
        runCurrent()

        val request = sharing.createRequests.single()
        assertEquals(StopChoice.After(StopMinutes.MINUTES_15), request.stop)
        assertEquals(Precision.APPROXIMATE, request.precision)
        assertEquals("Mom R", request.viewerName)
        // Every Sprint 2 share is manual: no call and no share back.
        assertNull(request.callId)
        assertFalse(request.shareBackAllowed)

        assertEquals(ShareSheetContent(FakeSharingRepository.shareFor(request).linkUrl, "Alex"), vm.state.value.sheet)
        vm.onSheetOpened()
        assertNull(vm.state.value.sheet)
        assertTrue("busy until the sheet closes", vm.state.value.busy)

        vm.onSheetClosed(ShareSheetOutcome.Sent)
        runCurrent()
        assertEquals(listOf(ShareEvent.Shared), events)
        assertEquals(0, sharing.discards)
        assertFalse(vm.state.value.busy)
    }

    @Test
    fun noNameSendsNone() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        vm.clearViewerName()
        vm.share()
        runCurrent()
        assertNull(sharing.createRequests.single().viewerName)
    }

    @Test
    fun aSheetClosedWithoutAChoiceTakesTheLinkBack() = runTest(main.dispatcher.scheduler) {
        val (vm, events) = vm()
        vm.share()
        runCurrent()
        vm.onSheetOpened()
        vm.onSheetClosed(ShareSheetOutcome.Closed)
        runCurrent()
        assertEquals(1, sharing.discards)
        assertEquals(ShareState.Idle, sharing.state.value)
        assertTrue("the screen stays", events.isEmpty())
        assertFalse(vm.state.value.busy)
        // And sharing again works.
        vm.share()
        runCurrent()
        assertEquals(2, sharing.createRequests.size)
    }

    @Test
    fun aLinkOpenedBeforeTheSheetClosedKeepsSharing() = runTest(main.dispatcher.scheduler) {
        sharing.nextDiscard = DiscardShareResult.LinkOpened
        val (vm, events) = vm()
        vm.share()
        runCurrent()
        vm.onSheetOpened()
        vm.onSheetClosed(ShareSheetOutcome.Closed)
        runCurrent()
        assertEquals(listOf(ShareEvent.Shared), events)
    }

    @Test
    fun aDiscardThatFailsLeavesTheScreenAsItWas() = runTest(main.dispatcher.scheduler) {
        sharing.nextDiscard = DiscardShareResult.Failed(SharingFailure.Network)
        val (vm, events) = vm()
        vm.share()
        runCurrent()
        vm.onSheetOpened()
        vm.onSheetClosed(ShareSheetOutcome.Closed)
        runCurrent()
        assertTrue(events.isEmpty())
        assertFalse(vm.state.value.busy)
        assertNull(vm.state.value.error)
    }

    @Test
    fun failuresSayWhyAndLetThePersonTryAgain() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        val cases = listOf(
            CreateShareResult.Failed(SharingFailure.Network) to ShareError.Network,
            CreateShareResult.AlreadySharing("other") to ShareError.AlreadySharing,
            CreateShareResult.Failed(SharingFailure.LocationPermission) to ShareError.Location,
            CreateShareResult.Failed(SharingFailure.Invalid) to ShareError.Other,
            CreateShareResult.Failed(SharingFailure.NotInForeground) to ShareError.Other,
        )
        cases.forEach { (result, error) ->
            sharing.nextCreate = { result }
            vm.share()
            runCurrent()
            assertEquals(error, vm.state.value.error)
            assertFalse(vm.state.value.busy)
            assertNull(vm.state.value.sheet)
        }
        sharing.nextCreate = { CreateShareResult.Created(FakeSharingRepository.shareFor(it)) }
        vm.share()
        assertNull("trying again clears the error", vm.state.value.error)
    }

    @Test
    fun aSecondTapWhileSharingStartsIsIgnored() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        vm.share()
        vm.share()
        runCurrent()
        vm.share()
        runCurrent()
        assertEquals(1, sharing.createRequests.size)
    }

    @Test
    fun aNameWithoutLettersOrNumbersIsRefusedAtTheField() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        vm.onViewerNameChange("...")
        vm.share()
        runCurrent()
        assertTrue(vm.state.value.nameError)
        assertTrue(sharing.createRequests.isEmpty())
        vm.onViewerNameChange("Mom")
        assertFalse("editing clears it", vm.state.value.nameError)
    }

    @Test
    fun preciseAsksTheSystemFirstWhenOnlyApproximateIsAllowed() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(preciseLocation = false)
        val (vm, events) = vm()
        vm.onPrecisionChange(Precision.PRECISE)
        runCurrent()
        assertEquals(listOf(ShareEvent.RequestPrecise), events)
        assertEquals(Precision.APPROXIMATE, vm.state.value.precision)

        // Keep approximate location: nothing changes.
        vm.onPreciseResult(mapOf(FakeLocationPermissions.FINE to false, FakeLocationPermissions.COARSE to true))
        runCurrent()
        assertEquals(Precision.APPROXIMATE, vm.state.value.precision)

        // Change to precise location: Precise.
        vm.onPrecisionChange(Precision.PRECISE)
        vm.onPreciseResult(mapOf(FakeLocationPermissions.FINE to true, FakeLocationPermissions.COARSE to true))
        runCurrent()
        assertEquals(Precision.PRECISE, vm.state.value.precision)
        assertTrue(vm.state.value.preciseAllowed)
    }

    @Test
    fun preciseTurnedOffInSettingsMakesTheShareApproximate() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        assertEquals(Precision.PRECISE, vm.state.value.precision)
        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(preciseLocation = false)
        runCurrent()
        assertEquals(Precision.APPROXIMATE, vm.state.value.precision)
        assertFalse(vm.state.value.preciseAllowed)
    }

    @Test
    fun shareAgainSharesAtOnceWithTheUsualChoices() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm(autoShare = true)
        runCurrent()
        val request = sharing.createRequests.single()
        assertEquals("Mom", request.viewerName)
        assertEquals(StopChoice.After(StopMinutes.MINUTES_30), request.stop)
        assertNotNull(vm.state.value.sheet)
    }

    @Test
    fun permissionStateIsReadNotRequestedOnOpen() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = permissions.state.value.copy(notifications = PermissionStatus.NotAsked)
        vm()
        assertTrue(permissions.locationResults.isEmpty())
        assertTrue(permissions.notificationResults.isEmpty())
    }
}
