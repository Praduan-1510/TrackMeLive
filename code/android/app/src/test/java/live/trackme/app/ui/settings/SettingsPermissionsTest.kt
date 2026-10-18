package live.trackme.app.ui.settings

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.auth.AccountRepository
import live.trackme.app.data.auth.DeleteAccountResult
import live.trackme.app.data.location.PermissionStatus as SystemPermission
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.settings.DefaultSettingsRepository
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.fakes.FakeLocalPreferences
import live.trackme.app.fakes.FakeLocationPermissions
import live.trackme.app.fakes.FakeProfileRepository
import live.trackme.app.fakes.MainDispatcherRule
import live.trackme.app.ui.routes.PermissionAction
import live.trackme.app.ui.routes.SettingsViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Settings › Permissions: each row's state from the system, and the way to change it. Robolectric for Intent. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class SettingsPermissionsTest {
    @get:Rule val main = MainDispatcherRule()

    private val permissions = FakeLocationPermissions()
    private val profiles = FakeProfileRepository(ProfileState.Ready(Profile(name = "Alex")))

    private object NoAccount : AccountRepository {
        override val deleting: StateFlow<Boolean> = MutableStateFlow(false)
        override suspend fun deleteAccount() = DeleteAccountResult.Deleted
    }

    private fun TestScope.vm(): Pair<SettingsViewModel, Unit> {
        val vm = SettingsViewModel(DefaultSettingsRepository(FakeLocalPreferences(SetupStage.Done), profiles), NoAccount, permissions)
        backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        return vm to Unit
    }

    @Test
    fun rowsShowWhatTheSystemSays() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        assertEquals(PermissionsUiState(PermissionStatus.NotAsked, preciseLocation = false, notifications = PermissionStatus.NotAsked), vm.state.value.permissions)

        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(preciseLocation = false, notifications = SystemPermission.DeniedForever)
        advanceUntilIdle()
        val p = vm.state.value.permissions
        assertEquals(PermissionStatus.Allowed, p.location)
        assertFalse(p.preciseLocation)
        assertEquals(PermissionStatus.Denied, p.notifications)

        permissions.mutableState.value = permissions.state.value.copy(location = SystemPermission.Denied)
        advanceUntilIdle()
        assertEquals(PermissionStatus.Denied, vm.state.value.permissions.location)
    }

    @Test
    fun resumingRereadsThePermissions() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        vm.onResume()
        assertEquals(1, permissions.refreshes)
    }

    @Test
    fun locationAsksTheFirstTimeAndOtherwiseOpensTheAppsPage() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        vm.onEvent(SettingsEvent.LocationPermissionTapped)
        assertEquals(PermissionAction.AskLocation, vm.permissionActions.first())

        listOf(SystemPermission.Granted, SystemPermission.Denied, SystemPermission.DeniedForever).forEach { status ->
            permissions.mutableState.value = permissions.state.value.copy(location = status)
            vm.onEvent(SettingsEvent.LocationPermissionTapped)
            assertEquals(status.name, "fake.APP_SETTINGS", (vm.permissionActions.first() as PermissionAction.OpenSettings).intent.action)
        }
    }

    @Test
    fun notificationsAskTheFirstTimeAndOtherwiseOpenTheirPage() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        vm.onEvent(SettingsEvent.NotificationsPermissionTapped)
        assertEquals(PermissionAction.AskNotifications(FakeLocationPermissions.NOTIFICATIONS), vm.permissionActions.first())

        permissions.mutableState.value = permissions.state.value.copy(notifications = SystemPermission.DeniedForever)
        vm.onEvent(SettingsEvent.NotificationsPermissionTapped)
        assertEquals("fake.NOTIFICATION_SETTINGS", (vm.permissionActions.first() as PermissionAction.OpenSettings).intent.action)

        vm.onNotificationResult(true)
        assertEquals(listOf(true), permissions.notificationResults)
    }
}
