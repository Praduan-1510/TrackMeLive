package live.trackme.app.service

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import live.trackme.app.R
import live.trackme.app.data.location.FusedLocationUpdates
import live.trackme.app.data.sharing.ForegroundStartRefused
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.SharingRepository
import live.trackme.app.data.sharing.SharingServiceController
import live.trackme.app.di.appContainer

/**
 * The location foreground service (type location): it runs only while a share is live, and keeps it
 * going in the background with the While-using location permission (FSD §8). It shows the ongoing
 * notification and keeps it current; the pings themselves run in the sharing repository.
 *
 * - Swiping the app away from Recents leaves it running ([onTaskRemoved] does nothing, and
 *   stopWithTask is false): sharing stops only by Stop, its timer, the call or the 1-hour limit.
 * - Android 14+ requires the location permission at [startForeground]; Android 12+ refuses to start a
 *   foreground service from the background. Both are checked; when either says no, the service stops at
 *   once rather than crash, and the repository tries again when the app is in the foreground.
 * - It stops itself whenever the share isn't live, so it can never outlive it.
 */
class LocationSharingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var watch: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        SharingNotification.createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val sharing = appContainer.sharing
        val live = sharing.state.value as? ShareState.Live
        // startForeground first, always: a service started with startForegroundService must call it.
        if (!enterForeground(sharing, live)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (live == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (watch == null) watch = scope.launch { keepNotificationCurrent(sharing) }
        // Restarted after the process is killed, the share picks up again (when Android allows it).
        return START_STICKY
    }

    private fun enterForeground(sharing: SharingRepository, live: ShareState.Live?): Boolean {
        if (!FusedLocationUpdates.hasLocationPermission(this)) {
            Log.w(TAG, "no location permission: can't run the location service")
            return false
        }
        val content = live?.let { SharingNotification.content(this, it, sharing.serverNowMillis()) }
            ?: SharingNotification.Content(getString(R.string.notification_sharing_title), null)
        return try {
            ServiceCompat.startForeground(
                this,
                SharingNotification.NOTIFICATION_ID,
                SharingNotification.build(this, content),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
            true
        } catch (e: IllegalStateException) {
            // ForegroundServiceStartNotAllowedException (Android 12+): started from the background.
            Log.w(TAG, "foreground start not allowed", e)
            false
        } catch (e: SecurityException) {
            // Android 14+: the location type without location access right now.
            Log.w(TAG, "location foreground service not allowed", e)
            false
        }
    }

    /** Re-draws the notification when the share changes, and every 30 s for the time-based lines; stops with the share. */
    private suspend fun keepNotificationCurrent(sharing: SharingRepository) {
        var shown: SharingNotification.Content? = null
        sharing.state.collectLatest { state ->
            if (state !is ShareState.Live) {
                stopSelf()
                return@collectLatest
            }
            while (true) {
                val content = SharingNotification.content(this, state, sharing.serverNowMillis())
                if (content != shown && NotificationManagerCompat.from(this).areNotificationsEnabled()) {
                    notify(content)
                    shown = content
                }
                delay(REFRESH_MS)
            }
        }
    }

    // areNotificationsEnabled is checked by the caller; on Android 13+ it reflects POST_NOTIFICATIONS.
    @SuppressLint("MissingPermission")
    private fun notify(content: SharingNotification.Content) {
        NotificationManagerCompat.from(this).notify(SharingNotification.NOTIFICATION_ID, SharingNotification.build(this, content))
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiped away from Recents: sharing keeps going, as the notification says.
    }

    override fun onDestroy() {
        scope.cancel()
        running = false
        super.onDestroy()
    }

    companion object {
        private const val TAG = "TmlSharingService"
        private const val REFRESH_MS = 30_000L

        @Volatile
        var running: Boolean = false
            private set
    }
}

/** [SharingServiceController] for [LocationSharingService]. */
class AndroidSharingServiceController(context: Context) : SharingServiceController {
    private val appContext = context.applicationContext

    override val isRunning: Boolean get() = LocationSharingService.running

    override fun start() {
        try {
            ContextCompat.startForegroundService(appContext, Intent(appContext, LocationSharingService::class.java))
        } catch (e: IllegalStateException) {
            // ForegroundServiceStartNotAllowedException (Android 12+), or a background start below that.
            throw ForegroundStartRefused(e)
        }
    }

    override fun stop() {
        appContext.stopService(Intent(appContext, LocationSharingService::class.java))
    }
}
