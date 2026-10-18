package live.trackme.app.data.location

import android.content.Intent
import kotlinx.coroutines.flow.StateFlow

/** Where a runtime permission stands, as the share screen and Settings need it. */
enum class PermissionStatus {
    /** Never asked on this install: ask (after the in-app explanation). */
    NotAsked,

    /** Allowed. For location this covers While using the app and Only this time. */
    Granted,

    /** Refused, and the system will still show its dialog: ask again. */
    Denied,

    /** Refused, and the system won't show its dialog any more: send the person to Settings. */
    DeniedForever,
}

/** Every permission sharing depends on (FSD §8), read from the system. */
data class PermissionsState(
    /** Fine or coarse location. */
    val location: PermissionStatus,
    /**
     * True when precise (fine) location is allowed. False when only approximate is (or none): shares are
     * then Approximate, and the share screen can offer the system's precise upgrade by requesting
     * [LocationPermissions.locationPermissionsToRequest] again.
     */
    val preciseLocation: Boolean,
    /** The system's Location switch. When it's off, no fixes arrive even with the permission. */
    val locationServicesOn: Boolean,
    /**
     * Notifications: POST_NOTIFICATIONS on Android 13 and up. Below 13 there's nothing to ask: Granted,
     * unless the person turned the app's notifications off (then DeniedForever, fixed in Settings).
     */
    val notifications: PermissionStatus,
)

/**
 * The location and notification permissions (FSD §8).
 *
 * - Location is asked on the first share, with fine and coarse together (Android 12+ shows Precise and
 *   Approximate). "While using the app" is all sharing needs: it always starts in the app, and the
 *   location foreground service keeps it going in the background. The app never asks for
 *   ACCESS_BACKGROUND_LOCATION ("Allow all the time").
 * - Notifications (Android 13+) are asked right after the first link is sent. Without them the share
 *   still runs; Android lists it under active apps instead of the ongoing notification.
 * - A request the system answers "no" without showing its dialog is [PermissionStatus.DeniedForever]:
 *   the screen then offers [appSettingsIntent] (or [notificationSettingsIntent]).
 *
 * The screens run the requests with ActivityResultContracts and report the results here, so the state
 * knows a denial from a permanent one. Call [refresh] when the app resumes: the person may have changed
 * things in Settings.
 */
interface LocationPermissions {
    val state: StateFlow<PermissionsState>

    /** Reads everything from the system again. */
    fun refresh()

    /** For RequestMultiplePermissions: ACCESS_FINE_LOCATION and ACCESS_COARSE_LOCATION. */
    val locationPermissionsToRequest: Array<String>

    /** For RequestPermission: POST_NOTIFICATIONS on Android 13+, null below (nothing to ask). */
    val notificationPermissionToRequest: String?

    /** The location request's result (permission to granted). Updates [state]. */
    fun onLocationRequestResult(result: Map<String, Boolean>)

    /** The notification request's result. Updates [state]. */
    fun onNotificationRequestResult(granted: Boolean)

    /** The app's page in system Settings, for a location permission that's [PermissionStatus.DeniedForever]. */
    fun appSettingsIntent(): Intent

    /** The app's notification settings. */
    fun notificationSettingsIntent(): Intent

    /** The system Location settings, for when [PermissionsState.locationServicesOn] is false. */
    fun locationServicesIntent(): Intent
}
