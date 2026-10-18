package live.trackme.spike.calldetect

import android.app.ActivityManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Timestamped event log. Every entry goes to logcat (tag CallSpike), to files/events.log and to
 * the on-screen list. Each entry carries the process importance at the moment the code ran, so a
 * late delivery (a frozen process thawing) shows up as a timestamp gap plus a background state.
 */
object SpikeLog {
    const val TAG = "CallSpike"
    private const val MAX_ENTRIES = 400

    data class Entry(val wallMs: Long, val elapsedMs: Long, val source: String, val message: String, val state: String) {
        fun format(): String =
            "${TIME.get()!!.format(Date(wallMs))}  $source  $message  [$state]"
    }

    private val TIME = object : ThreadLocal<SimpleDateFormat>() {
        override fun initialValue() = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)
    }
    private val FILE_TIME = object : ThreadLocal<SimpleDateFormat>() {
        override fun initialValue() = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    }

    private val entries = ArrayDeque<Entry>()
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val main = Handler(Looper.getMainLooper())
    private var file: File? = null

    /** "resumed", "paused", "stopped" or "none", set by MainActivity. */
    @Volatile var uiState: String = "none"

    fun init(context: Context) {
        file = File(context.filesDir, "events.log")
    }

    fun log(source: String, message: String) {
        val entry = Entry(System.currentTimeMillis(), SystemClock.elapsedRealtime(), source, message, appState())
        Log.i(TAG, "$source | $message | ${entry.state}")
        synchronized(entries) {
            entries.addFirst(entry)
            while (entries.size > MAX_ENTRIES) entries.removeLast()
        }
        try {
            file?.appendText(
                "${FILE_TIME.get()!!.format(Date(entry.wallMs))} | +${entry.elapsedMs} | $source | $message | ${entry.state}\n"
            )
        } catch (_: Exception) {
            // The on-screen and logcat copies are enough for the spike.
        }
        main.post { listeners.forEach { it() } }
    }

    /** Logcat only: used for the heartbeat so the on-screen list stays readable. */
    fun quiet(source: String, message: String) {
        Log.i(TAG, "$source | $message | ${appState()}")
    }

    fun snapshot(): List<Entry> = synchronized(entries) { entries.toList() }

    fun clear() {
        synchronized(entries) { entries.clear() }
        try { file?.writeText("") } catch (_: Exception) { }
        main.post { listeners.forEach { it() } }
    }

    fun addListener(listener: () -> Unit) { listeners.add(listener) }
    fun removeListener(listener: () -> Unit) { listeners.remove(listener) }

    fun appState(): String {
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        val importance = when (info.importance) {
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "FOREGROUND"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "FOREGROUND_SERVICE"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "VISIBLE"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE -> "PERCEPTIBLE"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE -> "SERVICE"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_CANT_SAVE_STATE -> "CANT_SAVE_STATE"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED -> "CACHED"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE -> "GONE"
            else -> info.importance.toString()
        }
        return "imp=$importance ui=$uiState fgs=${ShareService.running}"
    }
}
