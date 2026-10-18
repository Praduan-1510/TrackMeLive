package live.trackme.app.service

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import live.trackme.app.MainActivity
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.SharingRepository

/**
 * The ongoing notification's taps, which open the app (Android 12+ forbids a notification from starting
 * an activity through a service or receiver, so they go straight to MainActivity):
 * - the notification itself and Open: [ACTION_OPEN_SHARE], the live screen;
 * - Stop sharing: [ACTION_CONFIRM_STOP], the live screen with its Stop dialog (FSD §8: Stop sharing
 *   opens the app to confirm).
 *
 * A tap on the link-opened alert comes here too: FCM puts its data (type link_opened, session_id) in the
 * launcher intent's extras, and so does the alert this app shows itself while in front.
 *
 * MainActivity passes every intent it gets (onCreate and onNewIntent) to [handle].
 */
object SharingIntents {
    const val ACTION_OPEN_SHARE = "live.trackme.app.action.OPEN_SHARE"
    const val ACTION_CONFIRM_STOP = "live.trackme.app.action.CONFIRM_STOP"

    /** What a notification tap asks the app to show. */
    enum class Request {
        /** The live screen. */
        OpenShare,

        /** The live screen, with its Stop dialog ([SharingRepository.stopConfirmationRequested] is now true). */
        ConfirmStop,
    }

    /**
     * Reads a notification tap. Returns null for any other intent (the launcher's), and for a tap that
     * arrives after the share has ended: there's no live screen to show then, and nothing to stop.
     */
    fun handle(intent: Intent?, sharing: SharingRepository): Request? {
        val live = sharing.state.value as? ShareState.Live
        if (intent?.getStringExtra(LinkOpenedAlert.EXTRA_TYPE) == LinkOpenedAlert.TYPE) {
            // The live screen when the alert is about the share still running; otherwise Home (null).
            val sessionId = intent.getStringExtra(LinkOpenedAlert.EXTRA_SESSION_ID)
            return Request.OpenShare.takeIf { live != null && live.share.sessionId == sessionId }
        }
        val action = intent?.action ?: return null
        if (action != ACTION_OPEN_SHARE && action != ACTION_CONFIRM_STOP) return null
        if (live == null) return null
        return if (action == ACTION_CONFIRM_STOP) {
            sharing.requestStopConfirmation()
            Request.ConfirmStop
        } else {
            Request.OpenShare
        }
    }

    fun openShare(context: Context): PendingIntent = activity(context, ACTION_OPEN_SHARE, REQUEST_OPEN)

    fun confirmStop(context: Context): PendingIntent = activity(context, ACTION_CONFIRM_STOP, REQUEST_STOP)

    private fun activity(context: Context, action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(action)
            // Brings the app's task forward; a MainActivity already on top gets onNewIntent.
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private const val REQUEST_OPEN = 1
    private const val REQUEST_STOP = 2
}
