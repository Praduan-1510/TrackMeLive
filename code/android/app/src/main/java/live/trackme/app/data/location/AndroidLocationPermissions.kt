package live.trackme.app.data.location

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.location.LocationManagerCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * [LocationPermissions] from the system.
 *
 * Android doesn't say whether a refusal is permanent. Right after a request it can be told: when the
 * system answers no and wouldn't show a rationale either, it won't ask again (the person refused twice,
 * or chose don't ask again). That's remembered on the phone until the permission is granted, so
 * Settings and the share screen offer Settings instead of a request that would do nothing.
 */
class AndroidLocationPermissions(
    private val context: Context,
    private val currentActivity: () -> Activity?,
    private val prefs: SharedPreferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE),
    private val sdkInt: Int = Build.VERSION.SDK_INT,
) : LocationPermissions {
    private val mutableState = MutableStateFlow(read())
    override val state: StateFlow<PermissionsState> = mutableState.asStateFlow()

    override val locationPermissionsToRequest: Array<String> = arrayOf(FINE, COARSE)

    // A getter, not a stored value: the first read() runs before properties declared below it are set.
    override val notificationPermissionToRequest: String?
        get() = if (sdkInt >= Build.VERSION_CODES.TIRAMISU) POST_NOTIFICATIONS else null

    override fun refresh() {
        mutableState.value = read()
    }

    override fun onLocationRequestResult(result: Map<String, Boolean>) {
        val granted = result[FINE] == true || result[COARSE] == true || isGranted(FINE) || isGranted(COARSE)
        recordAnswer(LOCATION, granted, listOf(FINE, COARSE))
        refresh()
    }

    override fun onNotificationRequestResult(granted: Boolean) {
        val permission = notificationPermissionToRequest ?: return refresh()
        recordAnswer(NOTIFICATIONS, granted || isGranted(permission), listOf(permission))
        refresh()
    }

    override fun appSettingsIntent(): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))

    override fun notificationSettingsIntent(): Intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)

    override fun locationServicesIntent(): Intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)

    private fun read(): PermissionsState {
        val fine = isGranted(FINE)
        val coarse = isGranted(COARSE)
        val locationManager = context.getSystemService(LocationManager::class.java)
        return PermissionsState(
            location = statusOf(LOCATION, fine || coarse),
            preciseLocation = fine,
            locationServicesOn = locationManager != null && LocationManagerCompat.isLocationEnabled(locationManager),
            notifications = notificationStatus(),
        )
    }

    private fun notificationStatus(): PermissionStatus {
        val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        val permission = notificationPermissionToRequest
            // Below Android 13 there's nothing to ask: on, or turned off in Settings.
            ?: return if (enabled) PermissionStatus.Granted else PermissionStatus.DeniedForever
        val status = statusOf(NOTIFICATIONS, isGranted(permission))
        // Allowed, but the person turned the app's notifications off in Settings.
        return if (status == PermissionStatus.Granted && !enabled) PermissionStatus.DeniedForever else status
    }

    private fun statusOf(key: String, granted: Boolean): PermissionStatus = when {
        granted -> PermissionStatus.Granted
        !prefs.getBoolean(key + ASKED, false) -> PermissionStatus.NotAsked
        prefs.getBoolean(key + FOREVER, false) -> PermissionStatus.DeniedForever
        else -> PermissionStatus.Denied
    }

    private fun recordAnswer(key: String, granted: Boolean, permissions: List<String>) {
        // Without an Activity the rationale can't be read; then it isn't called permanent.
        val activity = currentActivity()
        val forever = !granted && activity != null &&
            permissions.none { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }
        prefs.edit {
            putBoolean(key + ASKED, true)
            putBoolean(key + FOREVER, forever)
        }
    }

    private fun isGranted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private companion object {
        const val FILE = "tml_permissions"
        const val FINE = Manifest.permission.ACCESS_FINE_LOCATION
        const val COARSE = Manifest.permission.ACCESS_COARSE_LOCATION
        /** Manifest.permission.POST_NOTIFICATIONS (Android 13), spelled out so older SDK levels can name it. */
        const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"
        const val LOCATION = "location"
        const val NOTIFICATIONS = "notifications"
        const val ASKED = "_asked"
        const val FOREVER = "_forever"
    }
}
