package live.trackme.app.data.sharing

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import androidx.core.content.edit

/** The share this phone started, and whose account it belongs to. */
data class StoredShare(val userId: String, val share: ActiveShare)

/**
 * Keeps the current share on the phone, so a share survives the process being killed: the link for
 * Send link again (the server returns its token only once), and the server clock's offset for this boot.
 */
interface ShareStore {
    fun load(): StoredShare?

    fun save(stored: StoredShare)

    fun clear()

    /** The server clock offset saved in this boot, or null (none saved, or the phone restarted since). */
    fun loadClockOffset(): Long?

    fun saveClockOffset(offsetMillis: Long)
}

/**
 * [ShareStore] in a private SharedPreferences file, written synchronously so a share is on disk before
 * its link is sent. App data isn't backed up (allowBackup is false), so the link never leaves the phone.
 */
class PreferencesShareStore(
    private val prefs: SharedPreferences,
    /** Settings.Global.BOOT_COUNT: the monotonic clock behind the offset restarts with each boot. */
    private val bootCount: () -> Int,
) : ShareStore {

    constructor(context: Context) : this(
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE),
        bootCount = { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1) },
    )

    override fun load(): StoredShare? {
        val userId = prefs.getString(USER_ID, null) ?: return null
        val sessionId = prefs.getString(SESSION_ID, null) ?: return null
        val link = prefs.getString(LINK_URL, null) ?: return null
        if (!prefs.contains(STARTED_AT) || !prefs.contains(EXPIRES_AT)) return null
        return StoredShare(
            userId,
            ActiveShare(
                sessionId = sessionId,
                linkUrl = link,
                viewerName = prefs.getString(VIEWER_NAME, null),
                callId = prefs.getString(CALL_ID, null),
                startedAtMillis = prefs.getLong(STARTED_AT, 0),
                expiresAtMillis = prefs.getLong(EXPIRES_AT, 0),
            ),
        )
    }

    override fun save(stored: StoredShare) {
        prefs.edit(commit = true) {
            putString(USER_ID, stored.userId)
            putString(SESSION_ID, stored.share.sessionId)
            putString(LINK_URL, stored.share.linkUrl)
            putString(VIEWER_NAME, stored.share.viewerName)
            putString(CALL_ID, stored.share.callId)
            putLong(STARTED_AT, stored.share.startedAtMillis)
            putLong(EXPIRES_AT, stored.share.expiresAtMillis)
        }
    }

    override fun clear() {
        prefs.edit(commit = true) {
            listOf(USER_ID, SESSION_ID, LINK_URL, VIEWER_NAME, CALL_ID, STARTED_AT, EXPIRES_AT).forEach(::remove)
        }
    }

    override fun loadClockOffset(): Long? {
        if (!prefs.contains(CLOCK_OFFSET)) return null
        val boot = bootCount()
        if (boot < 0 || prefs.getInt(CLOCK_BOOT, -2) != boot) return null
        return prefs.getLong(CLOCK_OFFSET, 0)
    }

    override fun saveClockOffset(offsetMillis: Long) {
        val boot = bootCount()
        if (boot < 0) return
        prefs.edit {
            putLong(CLOCK_OFFSET, offsetMillis)
            putInt(CLOCK_BOOT, boot)
        }
    }

    private companion object {
        const val FILE = "tml_share"
        const val USER_ID = "user_id"
        const val SESSION_ID = "session_id"
        const val LINK_URL = "link_url"
        const val VIEWER_NAME = "viewer_name"
        const val CALL_ID = "call_id"
        const val STARTED_AT = "started_at"
        const val EXPIRES_AT = "expires_at"
        const val CLOCK_OFFSET = "clock_offset"
        const val CLOCK_BOOT = "clock_boot"
    }
}
