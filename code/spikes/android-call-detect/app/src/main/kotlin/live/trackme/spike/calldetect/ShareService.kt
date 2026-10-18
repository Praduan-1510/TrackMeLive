package live.trackme.spike.calldetect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder

/**
 * Stands in for the real app's sharing service: a location-type foreground service started while
 * the activity is visible. It does nothing but keep the process out of the cached (frozen) state,
 * which is the one thing that decides whether the audio-mode listener runs in the background.
 */
class ShareService : Service() {

    companion object {
        private const val CHANNEL = "spike"
        @Volatile var running = false
            private set

        fun start(context: Context) {
            context.startForegroundService(Intent(context, ShareService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ShareService::class.java))
        }
    }

    override fun onCreate() {
        super.onCreate()
        CallMonitor.start(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Spike service", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Call detect spike")
            .setContentText("Watching the audio mode in the background")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        try {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            running = true
            SpikeLog.log("FGS", "foreground service started (type=location)")
        } catch (e: Exception) {
            SpikeLog.log("FGS", "startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        SpikeLog.log("FGS", "foreground service stopped")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
