package live.trackme.app.ui.share

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Resources
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import live.trackme.app.R

/** What the system share sheet carries (FSD §4 Live map link; prototype › sharesheet). */
data class ShareSheetContent(
    /** The share link, `<viewer origin>/s/<token>`. */
    val link: String,
    /** The sharer's own name, for the sheet's preview: "Alex · Live location". */
    val sharerName: String,
) {
    /** "I'm sharing my live location with you. https://trackme.live/s/…" */
    fun message(resources: Resources): String = resources.getString(R.string.share_sheet_message, link)

    fun title(resources: Resources): String = resources.getString(R.string.share_sheet_title, sharerName)
}

/** How the share sheet closed. */
enum class ShareSheetOutcome {
    /** The link went somewhere: an app, a person, Nearby Share, or Copy (copying counts as sent). */
    Sent,

    /** It closed without a choice: nobody got the link. */
    Closed,
}

/**
 * Whether the share sheet sent the link. Android reports the chosen app through the chooser's
 * callback; its own Copy button doesn't, so a clip put on the clipboard while the sheet was open
 * counts as sent too. Only the clip's timestamp is read, never its text, so the system shows no
 * "pasted from your clipboard" notice.
 */
fun shareSheetOutcome(targetChosen: Boolean, clipTimestampMillis: Long?, openedAtMillis: Long): ShareSheetOutcome = when {
    targetChosen -> ShareSheetOutcome.Sent
    // Not knowing when the sheet opened, a clip proves nothing.
    openedAtMillis <= 0L -> ShareSheetOutcome.Closed
    clipTimestampMillis != null && clipTimestampMillis >= openedAtMillis -> ShareSheetOutcome.Sent
    else -> ShareSheetOutcome.Closed
}

/** Opens the system share sheet: see [rememberShareSheet]. */
fun interface ShareSheet {
    fun open(content: ShareSheetContent)
}

/**
 * The Android share sheet (ACTION_SEND through the chooser) with the message and the link. The app
 * never sends anything itself; the person picks Messages, WhatsApp, Mail, Copy and so on.
 * [onClosed] says whether the link went anywhere, once the sheet is gone and the app has focus back.
 */
@Composable
fun rememberShareSheet(onClosed: (ShareSheetOutcome) -> Unit): ShareSheet {
    val context = LocalContext.current
    val windowInfo = LocalWindowInfo.current
    val scope = rememberCoroutineScope()
    val closed by rememberUpdatedState(onClosed)
    val session = remember { SheetSession() }
    // Kept across recreation (rotation while the sheet is up), so a clip from before the sheet never counts.
    var openedAt by rememberSaveable { mutableLongStateOf(0L) }

    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                session.targetChosen = true
            }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(ACTION_TARGET_CHOSEN), ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose { context.unregisterReceiver(receiver) }
    }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        scope.launch {
            // The clipboard answers only once the app has focus again, and the chosen-app callback can
            // land just after the result: wait for focus (briefly), then decide.
            withTimeoutOrNull(FOCUS_WAIT_MILLIS) { snapshotFlow { windowInfo.isWindowFocused }.first { it } }
            val clip = context.getSystemService(ClipboardManager::class.java)?.primaryClipDescription?.timestamp
            closed(shareSheetOutcome(session.targetChosen, clip, openedAt))
        }
    }

    return remember(context, launcher) {
        ShareSheet { content ->
            session.targetChosen = false
            openedAt = System.currentTimeMillis()
            launcher.launch(chooserIntent(context, content))
        }
    }
}

/** The chooser for [content], reporting the chosen app back to this app only. */
fun chooserIntent(context: Context, content: ShareSheetContent): Intent {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, content.message(context.resources))
        putExtra(Intent.EXTRA_TITLE, content.title(context.resources))
    }
    // Mutable, so the chooser can add EXTRA_CHOSEN_COMPONENT; explicit (our package), as Android 14 requires.
    val callback = PendingIntent.getBroadcast(
        context,
        0,
        Intent(ACTION_TARGET_CHOSEN).setPackage(context.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )
    return Intent.createChooser(send, null, callback.intentSender)
}

/** Whether an app was chosen while the sheet was open. */
private class SheetSession {
    @Volatile var targetChosen = false
}

internal const val ACTION_TARGET_CHOSEN = "live.trackme.app.action.SHARE_TARGET_CHOSEN"
private const val FOCUS_WAIT_MILLIS = 1_000L
