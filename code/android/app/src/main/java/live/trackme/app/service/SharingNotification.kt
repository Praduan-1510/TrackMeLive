package live.trackme.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.core.text.BidiFormatter
import java.util.Date
import live.trackme.app.R
import live.trackme.app.data.sharing.GpsSignal
import live.trackme.app.data.sharing.ShareState
import live.trackme.schema.StopRule

/**
 * The location service's ongoing notification (FSD §8 Background sharing; the prototype's shade):
 * "Sharing your location with Mom", then when sharing stops or what's wrong, with Open and Stop sharing.
 * Silent, on its own channel ("Sharing in progress"). Without the notification permission Android lists
 * the service under active apps instead, and sharing goes on.
 */
object SharingNotification {
    const val CHANNEL_ID = "sharing"
    const val NOTIFICATION_ID = 1

    /** The title and second line for [state] at [serverNowMillis]. */
    data class Content(val title: String, val text: String?)

    fun content(context: Context, state: ShareState.Live, serverNowMillis: Long): Content {
        val name = state.share.viewerName?.trim()?.takeIf { it.isNotEmpty() }
        val title = if (name == null) {
            context.getString(R.string.notification_sharing_title)
        } else {
            // The name is isolated, so a right-to-left name doesn't reorder the sentence.
            context.getString(R.string.notification_sharing_title_with, BidiFormatter.getInstance().unicodeWrap(name))
        }
        val time = { millis: Long -> android.text.format.DateFormat.getTimeFormat(context).format(Date(millis)) }
        val lastSeen = state.upload.lastPoint?.recordedAtMillis
        val session = state.session
        val text = when {
            state.upload.offline -> lastSeen?.let { context.getString(R.string.notification_no_connection_last_seen, time(it)) }
                ?: context.getString(R.string.notification_no_connection)
            state.upload.signal == GpsSignal.NoSignal -> lastSeen?.let { context.getString(R.string.notification_no_gps_last_seen, time(it)) }
                ?: context.getString(R.string.notification_no_gps)
            session == null -> null
            session.limitSoon(serverNowMillis) -> context.getString(R.string.notification_limit_soon, time(session.expiresAtMillis))
            session.stopRule == StopRule.CALL -> context.getString(R.string.notification_until_call_ends)
            else -> context.getString(R.string.notification_until, time(session.endsAtMillis))
        }
        return Content(title, text)
    }

    fun build(context: Context, content: Content): Notification =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sharing)
            .setContentTitle(content.title)
            .setContentText(content.text)
            .setSubText(context.getString(R.string.notification_sharing_subtext))
            .setContentIntent(SharingIntents.openShare(context))
            .addAction(0, context.getString(R.string.notification_action_open), SharingIntents.openShare(context))
            .addAction(0, context.getString(R.string.notification_action_stop), SharingIntents.confirmStop(context))
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_LOCATION_SHARING)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // Shown at once, not after Android's 10-second grace for short foreground services.
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    /** Creates the channel (again is a no-op). Low importance: no sound, no heads-up. */
    fun createChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_sharing),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.notification_channel_sharing_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }
}
