package live.trackme.app.ui

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.auth.AccountRepository
import live.trackme.app.data.auth.DeleteAccountResult
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.settings.Appearance
import live.trackme.app.data.settings.DefaultSettingsRepository
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.fakes.FakeLocalPreferences
import live.trackme.app.fakes.FakeProfileRepository
import live.trackme.app.fakes.MainDispatcherRule
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.mascot.MascotPickerMode
import live.trackme.app.ui.routes.MascotEvent
import live.trackme.app.ui.routes.MascotViewModel
import live.trackme.app.ui.routes.SettingsMessage
import live.trackme.app.ui.routes.SettingsViewModel
import live.trackme.app.ui.settings.SettingsEvent
import live.trackme.schema.DefaultStop
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.Precision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MascotAndSettingsViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private val profiles = FakeProfileRepository(ProfileState.Ready(Profile(name = "Alex")))
    private val prefs = FakeLocalPreferences(SetupStage.Mascot)

    @Test
    fun setupContinueSavesThePickAndOpensHome() = runTest(main.dispatcher.scheduler) {
        val vm = MascotViewModel(MascotPickerMode.Setup, profiles, prefs)
        backgroundScope.launch { vm.state.collect {} }
        runCurrent()
        assertEquals(MascotLook(), vm.state.value.initial)
        vm.save(MascotId.GHOST, MascotColor.MOSS, MascotAccessory.HEADLAMP)
        advanceUntilIdle()
        val saved = profiles.updates.single()
        assertEquals(MascotId.GHOST, saved.mascotId)
        assertEquals(MascotColor.MOSS, saved.mascotColor)
        assertEquals(MascotAccessory.HEADLAMP, saved.mascotAccessory)
        assertEquals(SetupStage.Done, prefs.setupStage.value)
    }

    @Test
    fun anAccessoryTheMascotCantWearIsDropped() = runTest(main.dispatcher.scheduler) {
        val vm = MascotViewModel(MascotPickerMode.Tab, profiles, prefs)
        vm.save(MascotId.ASTRONAUT, MascotColor.ORIGINAL, MascotAccessory.GLASSES)
        advanceUntilIdle()
        assertEquals(null, profiles.updates.single().mascotAccessory)
    }

    @Test
    fun theTabConfirmsAndAFailedSaveKeepsThePick() = runTest(main.dispatcher.scheduler) {
        val vm = MascotViewModel(MascotPickerMode.Tab, profiles, prefs)
        val events = mutableListOf<MascotEvent>()
        backgroundScope.launch { vm.eventFlow.toList(events) }
        backgroundScope.launch { vm.state.collect {} }
        vm.save(MascotId.NEKO, MascotColor.ROSE, null)
        advanceUntilIdle()
        assertEquals(listOf<MascotEvent>(MascotEvent.Saved), events)
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)

        profiles.failSave = ProfileFailure.Network
        vm.save(MascotId.ACE, MascotColor.DUSK, null)
        advanceUntilIdle()
        assertTrue(vm.state.value.saveFailed)
        assertEquals(MascotLook(MascotId.ACE, MascotColor.DUSK), vm.state.value.initial)
    }

    private class FakeAccount(var result: DeleteAccountResult) : AccountRepository {
        var calls = 0
        var hold: CompletableDeferred<Unit>? = null
        override val deleting = MutableStateFlow(false)
        override suspend fun deleteAccount(): DeleteAccountResult {
            calls++
            deleting.value = true
            hold?.await()
            deleting.value = false
            return result
        }
    }

    @Test
    fun aToggleDuringADeleteDoesNotSaveAndADoubleConfirmDeletesOnce() = runTest(main.dispatcher.scheduler) {
        val account = FakeAccount(DeleteAccountResult.Deleted).apply { hold = CompletableDeferred() }
        val vm = SettingsViewModel(DefaultSettingsRepository(prefs, profiles), account)
        backgroundScope.launch { vm.state.collect {} }
        vm.onEvent(SettingsEvent.DeleteAccountConfirmed)
        advanceUntilIdle()
        assertTrue(vm.state.value.deleting)

        vm.onEvent(SettingsEvent.DeleteAccountConfirmed)
        vm.onEvent(SettingsEvent.ShareBackChanged(false))
        advanceUntilIdle()
        assertEquals("deleteAccount ran once", 1, account.calls)
        assertTrue("no save mid-delete", profiles.updates.isEmpty())

        account.hold!!.complete(Unit)
        advanceUntilIdle()
        assertFalse(vm.state.value.deleting)
    }

    @Test
    fun settingsSaveWithTheProfileAndAppearanceStaysLocal() = runTest(main.dispatcher.scheduler) {
        val vm = SettingsViewModel(DefaultSettingsRepository(prefs, profiles), FakeAccount(DeleteAccountResult.Deleted))
        backgroundScope.launch { vm.state.collect {} }
        vm.onEvent(SettingsEvent.PrecisionChanged(Precision.APPROXIMATE))
        vm.onEvent(SettingsEvent.DefaultStopChanged(DefaultStop.MINUTES_15))
        vm.onEvent(SettingsEvent.ShareBackChanged(false))
        vm.onEvent(SettingsEvent.AppearanceChanged(Appearance.Dark))
        advanceUntilIdle()
        val s = vm.state.value
        assertEquals(Precision.APPROXIMATE, s.precision)
        assertEquals(DefaultStop.MINUTES_15, s.defaultStop)
        assertFalse(s.shareBack)
        assertEquals(Appearance.Dark, s.appearance)
        assertEquals(Appearance.Dark, prefs.appearance.value)
        assertEquals(3, profiles.updates.size)
        assertEquals(15L, profiles.updates.last().settings.defaultStopWire)
    }

    @Test
    fun settingsSayWhenTheProfileCantUpdate() = runTest(main.dispatcher.scheduler) {
        val vm = SettingsViewModel(DefaultSettingsRepository(prefs, profiles), FakeAccount(DeleteAccountResult.Deleted))
        backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        assertFalse(vm.state.value.updatesUnavailable)
        profiles.updatesUnavailable.value = true
        advanceUntilIdle()
        assertTrue(vm.state.value.updatesUnavailable)
        profiles.updatesUnavailable.value = false
        advanceUntilIdle()
        assertFalse(vm.state.value.updatesUnavailable)
    }

    @Test
    fun aFailedSettingsSaveSaysSo() = runTest(main.dispatcher.scheduler) {
        val vm = SettingsViewModel(DefaultSettingsRepository(prefs, profiles), FakeAccount(DeleteAccountResult.Deleted))
        val messages = mutableListOf<SettingsMessage>()
        backgroundScope.launch { vm.messageFlow.toList(messages) }
        profiles.failSave = ProfileFailure.Network
        vm.onEvent(SettingsEvent.AlertExpiryChanged(false))
        advanceUntilIdle()
        assertEquals(listOf<SettingsMessage>(SettingsMessage.SaveFailed), messages)
    }

    @Test
    fun deleteAccountReportsFailures() = runTest(main.dispatcher.scheduler) {
        val account = FakeAccount(DeleteAccountResult.Network)
        val vm = SettingsViewModel(DefaultSettingsRepository(prefs, profiles), account)
        val messages = mutableListOf<SettingsMessage>()
        backgroundScope.launch { vm.messageFlow.toList(messages) }
        vm.onEvent(SettingsEvent.DeleteAccountConfirmed)
        advanceUntilIdle()
        account.result = DeleteAccountResult.Deleted
        vm.onEvent(SettingsEvent.DeleteAccountConfirmed)
        advanceUntilIdle()
        assertEquals(2, account.calls)
        assertEquals(listOf<SettingsMessage>(SettingsMessage.DeleteFailed(offline = true)), messages)
    }
}
