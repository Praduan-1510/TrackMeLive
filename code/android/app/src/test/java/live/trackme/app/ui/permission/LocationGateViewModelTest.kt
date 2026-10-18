package live.trackme.app.ui.permission

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.location.PermissionStatus
import live.trackme.app.fakes.FakeLocationPermissions
import live.trackme.app.fakes.MainDispatcherRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Robolectric for Intent. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class LocationGateViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private val permissions = FakeLocationPermissions()
    private val granted = mapOf(FakeLocationPermissions.FINE to true, FakeLocationPermissions.COARSE to true)
    private val refused = mapOf(FakeLocationPermissions.FINE to false, FakeLocationPermissions.COARSE to false)

    private fun TestScope.gate(): Pair<LocationGateViewModel, MutableList<GateEvent>> {
        val vm = LocationGateViewModel(permissions)
        val events = mutableListOf<GateEvent>()
        backgroundScope.launch { vm.events.toList(events) }
        runCurrent()
        return vm to events
    }

    @Test
    fun firstTimeExplainsThenAsksThenCarriesOn() = runTest(main.dispatcher.scheduler) {
        val (vm, events) = gate()
        vm.start()
        runCurrent()
        assertEquals(1, permissions.refreshes)
        assertEquals(GatePrompt.Explainer, vm.prompt.value)
        assertTrue("nothing asked before Continue", events.isEmpty())

        vm.onContinue()
        runCurrent()
        assertEquals(GatePrompt.None, vm.prompt.value)
        assertEquals(listOf<GateEvent>(GateEvent.RequestLocation), events)

        vm.onResult(granted)
        runCurrent()
        assertEquals(listOf(GateEvent.RequestLocation, GateEvent.Granted), events)
        assertEquals(listOf(granted), permissions.locationResults)
    }

    @Test
    fun approximateIsEnoughToShare() = runTest(main.dispatcher.scheduler) {
        val (vm, events) = gate()
        vm.start()
        vm.onContinue()
        vm.onResult(mapOf(FakeLocationPermissions.FINE to false, FakeLocationPermissions.COARSE to true))
        runCurrent()
        assertEquals(GateEvent.Granted, events.last())
    }

    @Test
    fun notNowAsksNothing() = runTest(main.dispatcher.scheduler) {
        val (vm, events) = gate()
        vm.start()
        vm.onNotNow()
        runCurrent()
        assertEquals(GatePrompt.None, vm.prompt.value)
        assertTrue(events.isEmpty())
    }

    @Test
    fun aRefusalOffersSettingsAndComingBackAllowedCarriesOn() = runTest(main.dispatcher.scheduler) {
        val (vm, events) = gate()
        vm.start()
        vm.onContinue()
        vm.onResult(refused)
        runCurrent()
        assertEquals(GatePrompt.LocationOff, vm.prompt.value)

        vm.onOpenSettings()
        runCurrent()
        assertEquals(GatePrompt.None, vm.prompt.value)
        val open = events.last() as GateEvent.OpenSettings
        assertEquals("fake.APP_SETTINGS", open.intent.action)

        // Back from Settings with location allowed.
        permissions.mutableState.value = FakeLocationPermissions.AllGranted
        vm.onResume()
        runCurrent()
        assertEquals(GateEvent.Granted, events.last())
    }

    @Test
    fun comingBackWithoutAllowingDoesNothing() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = permissions.state.value.copy(location = PermissionStatus.DeniedForever)
        val (vm, events) = gate()
        vm.start()
        assertEquals(GatePrompt.LocationOff, vm.prompt.value)
        vm.onOpenSettings()
        vm.onResume()
        runCurrent()
        assertEquals(1, events.size)
        assertTrue(events.single() is GateEvent.OpenSettings)
        // A later resume (not from Settings) asks nothing either.
        permissions.mutableState.value = FakeLocationPermissions.AllGranted
        vm.onResume()
        runCurrent()
        assertEquals(1, events.size)
    }

    @Test
    fun refusedButAskableGoesStraightToTheSystemDialog() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = permissions.state.value.copy(location = PermissionStatus.Denied)
        val (vm, events) = gate()
        vm.start()
        runCurrent()
        assertEquals(GatePrompt.None, vm.prompt.value)
        assertEquals(listOf<GateEvent>(GateEvent.RequestLocation), events)
        // A second refusal is for good: Settings is the way back.
        vm.onResult(refused)
        assertEquals(PermissionStatus.DeniedForever, permissions.state.value.location)
        assertEquals(GatePrompt.LocationOff, vm.prompt.value)
    }

    @Test
    fun deniedForeverShowsTheWayToSettings() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = permissions.state.value.copy(location = PermissionStatus.DeniedForever)
        val (vm, events) = gate()
        vm.start()
        runCurrent()
        assertEquals(GatePrompt.LocationOff, vm.prompt.value)
        assertTrue(events.isEmpty())
    }

    @Test
    fun allowedCarriesOnAtOnce() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted
        val (vm, events) = gate()
        vm.start()
        runCurrent()
        assertEquals(listOf<GateEvent>(GateEvent.Granted), events)
    }

    @Test
    fun thePhonesLocationSwitchOffSendsToLocationSettings() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(locationServicesOn = false)
        val (vm, events) = gate()
        vm.start()
        assertEquals(GatePrompt.ServicesOff, vm.prompt.value)
        vm.onOpenSettings()
        runCurrent()
        assertEquals("fake.LOCATION_SETTINGS", (events.single() as GateEvent.OpenSettings).intent.action)
        permissions.mutableState.value = FakeLocationPermissions.AllGranted
        vm.onResume()
        runCurrent()
        assertEquals(GateEvent.Granted, events.last())
    }

    @Test
    fun grantedInTheDialogWithLocationOffAsksForTheSwitch() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = permissions.state.value.copy(locationServicesOn = false)
        val (vm, events) = gate()
        vm.start()
        vm.onContinue()
        vm.onResult(granted)
        runCurrent()
        assertEquals(GatePrompt.ServicesOff, vm.prompt.value)
        assertEquals(listOf<GateEvent>(GateEvent.RequestLocation), events)
    }
}
