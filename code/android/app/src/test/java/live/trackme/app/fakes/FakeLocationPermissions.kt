package live.trackme.app.fakes

import android.content.Intent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import live.trackme.app.data.location.LocationPermissions
import live.trackme.app.data.location.PermissionStatus
import live.trackme.app.data.location.PermissionsState

/**
 * [LocationPermissions] in memory. [mutableState] is settable; a request result updates it the way the
 * system would (a second denial reads as denied forever). Every call is recorded.
 */
class FakeLocationPermissions(
    initial: PermissionsState = PermissionsState(
        location = PermissionStatus.NotAsked,
        preciseLocation = false,
        locationServicesOn = true,
        notifications = PermissionStatus.NotAsked,
    ),
) : LocationPermissions {
    val mutableState = MutableStateFlow(initial)
    override val state: StateFlow<PermissionsState> = mutableState.asStateFlow()
    var refreshes = 0
        private set
    val locationResults = mutableListOf<Map<String, Boolean>>()
    val notificationResults = mutableListOf<Boolean>()

    override fun refresh() {
        refreshes++
    }

    override val locationPermissionsToRequest = arrayOf(FINE, COARSE)
    override val notificationPermissionToRequest: String? = NOTIFICATIONS

    override fun onLocationRequestResult(result: Map<String, Boolean>) {
        locationResults += result
        val fine = result[FINE] == true
        val coarse = result[COARSE] == true
        mutableState.value = mutableState.value.copy(
            location = when {
                fine || coarse -> PermissionStatus.Granted
                mutableState.value.location == PermissionStatus.Denied -> PermissionStatus.DeniedForever
                else -> PermissionStatus.Denied
            },
            preciseLocation = fine,
        )
    }

    override fun onNotificationRequestResult(granted: Boolean) {
        notificationResults += granted
        mutableState.value = mutableState.value.copy(
            notifications = when {
                granted -> PermissionStatus.Granted
                mutableState.value.notifications == PermissionStatus.Denied -> PermissionStatus.DeniedForever
                else -> PermissionStatus.Denied
            },
        )
    }

    override fun appSettingsIntent() = Intent("fake.APP_SETTINGS")

    override fun notificationSettingsIntent() = Intent("fake.NOTIFICATION_SETTINGS")

    override fun locationServicesIntent() = Intent("fake.LOCATION_SETTINGS")

    companion object {
        const val FINE = "android.permission.ACCESS_FINE_LOCATION"
        const val COARSE = "android.permission.ACCESS_COARSE_LOCATION"
        const val NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

        val AllGranted = PermissionsState(
            location = PermissionStatus.Granted,
            preciseLocation = true,
            locationServicesOn = true,
            notifications = PermissionStatus.Granted,
        )
    }
}
