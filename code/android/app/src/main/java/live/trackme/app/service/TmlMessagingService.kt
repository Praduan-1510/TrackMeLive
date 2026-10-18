package live.trackme.app.service

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import live.trackme.app.MainActivity
import live.trackme.app.R
import live.trackme.app.di.pushRegistration

/**
 * FCM for the alerts (Backend-Alerts): a new token updates this phone's device doc, and a link-opened
 * alert that arrives while the app is in front is shown here. In the background, Android shows it
 * itself, and a tap opens the app with the same extras, so both reach [SharingIntents.handle].
 */
class TmlMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        pushRegistration?.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val sessionId = message.data[LinkOpenedAlert.EXTRA_SESSION_ID] ?: return
        if (message.data[LinkOpenedAlert.EXTRA_TYPE] != LinkOpenedAlert.TYPE) return
        LinkOpenedAlert.show(this, sessionId, message.notification?.title, message.notification?.body)
    }
}

/** The link-opened alert: its channel, and showing it when it arrives with the app in front. */
object LinkOpenedAlert {
    const val CHANNEL_ID = "link_opened"
    const val TYPE = "link_opened"

    /** The data keys FCM puts in the launcher intent's extras (and this app's own notification too). */
    const val EXTRA_TYPE = "type"
    const val EXTRA_SESSION_ID = "session_id"

    fun createChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, context.getString(R.string.notification_channel_link_opened), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    // areNotificationsEnabled is checked first; on Android 13+ it reflects POST_NOTIFICATIONS.
    @SuppressLint("MissingPermission")
    fun show(context: Context, sessionId: String, title: String?, body: String?) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        createChannel(context)
        val tap = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .putExtra(EXTRA_TYPE, TYPE)
            .putExtra(EXTRA_SESSION_ID, sessionId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sharing)
            .setContentTitle(title ?: context.getString(R.string.notification_link_opened_title))
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(context, sessionId.hashCode(), tap, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        manager.notify("$TYPE:$sessionId", 0, notification)
    }
}
