package live.trackme.app.data.sharing

import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import live.trackme.schema.SharerSnapshot
import live.trackme.schema.StopMinutes
import live.trackme.schema.StopRule
import live.trackme.schema.TmlSchemaConstants

/** The share screen's Stops choice, or the timer sheet's (FSD §4 Stop rule). */
sealed interface StopChoice {
    /** When the call ends: only during a call, with the Phone permission. */
    data object WhenCallEnds : StopChoice

    /** In 15 min, In 30 min or In 1 hour: stop_at = now + minutes, capped at expires_at. */
    data class After(val minutes: StopMinutes) : StopChoice

    /** "At the 1-hour limit": stop_at = expires_at. */
    data object AtLimit : StopChoice
}

/** What the share screen sends to createSession. */
data class ShareRequest(
    val stop: StopChoice,
    val precision: Precision,
    /** The Let them share back switch. The server forces it off without a call. */
    val shareBackAllowed: Boolean,
    /** The connected call's per-device id (a generated UUID on Android), or null for a manual share. */
    val callId: String? = null,
    /** Who it's for, trimmed, 1 to 24 characters; null without a name. */
    val viewerName: String? = null,
)

/**
 * The share this phone started: what createSession returned, kept on the phone until the person taps
 * Done on the ended screen, so Send link again works after the app was killed. The link token in
 * [linkUrl] is returned only once by the server and never stored there in plaintext.
 */
data class ActiveShare(
    val sessionId: String,
    /** The share link, `<viewer origin>/s/<token>`, for the share sheet and Send link again. */
    val linkUrl: String,
    val viewerName: String?,
    val callId: String?,
    /** Server time, epoch ms. */
    val startedAtMillis: Long,
    /** Server time, epoch ms: the hard 1-hour limit. */
    val expiresAtMillis: Long,
)

/**
 * shareSessions/{sessionId} as the sharer's screens read it (FSD §6). Every time is server time in
 * epoch ms; compare it with [SharingRepository.serverNowMillis], never with the phone's clock.
 */
data class SessionView(
    /** status is active. A session past stop_at or expires_at is over even while this is still true. */
    val active: Boolean,
    val startedAtMillis: Long,
    val expiresAtMillis: Long,
    val stopRule: StopRule,
    val stopMinutes: StopMinutes?,
    val stopAtMillis: Long?,
    val endedAtMillis: Long?,
    val endReason: EndReason?,
    val callId: String?,
    /** True only while the session's own call is connected (Live Together). */
    val callActive: Boolean,
    val callEndedAtMillis: Long?,
    val shareBackAllowed: Boolean,
    /** The app's last check-in (server time). */
    val lastPingAtMillis: Long,
    /** recorded_at of the newest ping, or null before the first (the rules space pings from it). */
    val lastFixAtMillis: Long? = null,
    /** The ping interval in use, in seconds, as written by the app. */
    val pingIntervalSeconds: Double,
    val precision: Precision,
    /** A precision change waiting for the next ping, or null. */
    val precisionNext: Precision?,
    val sharer: SharerSnapshot,
    /** The first open of the link (the "Mom opened your link" moment), or null. */
    val firstViewedAtMillis: Long?,
    val viewerSharing: Boolean,
    val shareBackRequestedAtMillis: Long?,
    /** Where the sharer is, in words, as the session holds it ("Where Alex is"); null before the first lookup. */
    val place: SessionPlace? = null,
) {
    /** When sharing ends at the latest: the earlier of stop_at and expires_at. */
    val endsAtMillis: Long get() = stopAtMillis?.let { minOf(it, expiresAtMillis) } ?: expiresAtMillis

    /** The precision the next ping is written at. */
    val effectivePrecision: Precision get() = precisionNext ?: precision

    /**
     * How the session has ended by [serverNowMillis]: the server's own end once it has written one;
     * otherwise, from stop_at or expires_at on, the end that's due (an earlier stop_at is timer, the
     * 1-hour limit or a stop_at equal to it is limit), exactly as the rules and the stop job see it.
     * Null while it's live. With no server time yet (null), only the server's own end counts.
     */
    fun endAt(serverNowMillis: Long?): ShareEnd? {
        if (!active) {
            return ShareEnd(endReason ?: EndReason.STOPPED, endedAtMillis ?: endsAtMillis, confirmed = true)
        }
        val due = stopAtMillis?.takeIf { it < expiresAtMillis }
            ?.let { ShareEnd(EndReason.TIMER, it, confirmed = false) }
            ?: ShareEnd(EndReason.LIMIT, expiresAtMillis, confirmed = false)
        return if (serverNowMillis != null && serverNowMillis >= due.atMillis) due else null
    }

    /**
     * The 1-hour warning (FSD §4): from 5 minutes before expires_at, when the limit (not an earlier
     * timer) ends sharing. The line reads "Sharing stops at 10:38 pm · 1-hour limit".
     */
    fun limitSoon(serverNowMillis: Long?): Boolean =
        serverNowMillis != null &&
            endAt(serverNowMillis) == null &&
            endsAtMillis == expiresAtMillis &&
            serverNowMillis >= expiresAtMillis - TmlSchemaConstants.EXPIRY_WARNING_MINUTES * 60_000L
}

/** How a share ended. */
data class ShareEnd(
    /** stopped (the sharer tapped Stop), call, timer or limit: the prototype's ended states. */
    val reason: EndReason,
    /** When it ended, server time, epoch ms (for a timer or the limit: when it was due). */
    val atMillis: Long,
    /** The server has recorded this end. False while it's known only on the phone (offline, or due but not yet written). */
    val confirmed: Boolean,
)

/** The share on this phone, for every screen. */
sealed interface ShareState {
    /** Not sharing. */
    data object Idle : ShareState

    /**
     * Sharing: pings are being written. [session] is null until the first snapshot of the session doc.
     * [upload] says what the pings are doing (the sharer's own row: interval, No GPS signal, No connection).
     */
    data class Live(val share: ActiveShare, val session: SessionView?, val upload: UploadStatus) : ShareState

    /** Over, and no pings are written. Stays until [SharingRepository.dismissEnded] (Done or Share again). */
    data class Ended(val share: ActiveShare, val end: ShareEnd, val session: SessionView?) : ShareState
}

/** Why a sharing call failed. */
enum class SharingFailure {
    /** No connection, or the server didn't answer in time. */
    Network,

    /** The server says the sign-in has ended; the app signs out (AccountSession). */
    SignInEnded,

    /** Nobody is signed in with a phone number. */
    NotSignedIn,

    /** There's no profile yet (sign-up isn't finished). */
    NoProfile,

    /** Location isn't allowed, so the share can't start. */
    LocationPermission,

    /** Android refused to start the location service: the app wasn't in the foreground. */
    NotInForeground,

    /** There is no share to act on, or it's no longer live. */
    NotSharing,

    /** The server rejected the request. A bug on our side, never the person's doing. */
    Invalid,

    Other,
}

sealed interface CreateShareResult {
    /** The session exists, the location service runs and pings have started. Open the share sheet with the link. */
    data class Created(val share: ActiveShare) : CreateShareResult

    /** One share at a time: this account is already sharing ([sessionId]), from this phone or another. */
    data class AlreadySharing(val sessionId: String) : CreateShareResult

    data class Failed(val reason: SharingFailure) : CreateShareResult
}

sealed interface DiscardShareResult {
    /** The share sheet closed without a choice: the session and its pings are gone. Back to Idle. */
    data object Discarded : DiscardShareResult

    /** The link was already opened, so it can't be taken back: the share keeps going. */
    data object LinkOpened : DiscardShareResult

    data class Failed(val reason: SharingFailure) : DiscardShareResult
}

sealed interface UpdateShareResult {
    data object Updated : UpdateShareResult

    data class Failed(val reason: SharingFailure) : UpdateShareResult
}
