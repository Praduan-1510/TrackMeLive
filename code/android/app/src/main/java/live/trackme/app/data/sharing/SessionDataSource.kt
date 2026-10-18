package live.trackme.app.data.sharing

import kotlinx.coroutines.flow.Flow
import live.trackme.schema.CreateSessionResponse
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import live.trackme.schema.StopRule
import live.trackme.schema.StopSessionResponse

/** One read of shareSessions/{id}, as the data source sees it. */
sealed interface RemoteSession {
    /** [hasPendingWrites]: the snapshot includes this phone's writes the server hasn't confirmed yet. */
    data class Present(val session: SessionView, val hasPendingWrites: Boolean) : RemoteSession

    /** The session doc doesn't exist (discarded, or the account was deleted). */
    data object Missing : RemoteSession

    /** The listener stopped with an error; it emits nothing after this. */
    data class Failed(val reason: SharingFailure) : RemoteSession
}

/** A ping to write: the point as the viewer gets it (already rounded while Approximate). */
data class PingWrite(val lat: Double, val lng: Double, val accuracyM: Double, val recordedAtMillis: Long)

/**
 * The session fields that go with a ping or a check-in, in the same batch (firestore.rules
 * isSharerSessionUpdate). last_ping_at is always the server's time.
 */
data class CheckInWrite(
    /** ping_interval_s, when it changed; null leaves it. */
    val pingIntervalSeconds: Double? = null,
    /** Applying a pending precision_next: precision becomes this and precision_next null. */
    val applyPrecision: Precision? = null,
)

/** The session's server-written marks, epoch ms. */
data class ServerMarks(val lastPingAtMillis: Long, val lastFixAtMillis: Long?)

/** A stop rule as the session stores it. */
data class StopWrite(val rule: StopRule, val minutes: StopMinutes?, val stopAtMillis: Long?)

/**
 * Where sessions live: the session callables and shareSessions/{id} in the app, a fake in tests. Every
 * suspend function throws [SharingDataException].
 */
interface SessionDataSource {
    /** The createSession callable. A live session already running fails with [SharingFailure.Other] and [SharingDataException.activeSessionId]. */
    suspend fun create(request: ShareRequest): CreateSessionResponse

    /** The stopSession callable: idempotent, and says how the session ended. */
    suspend fun stop(sessionId: String): StopSessionResponse

    /** The discardSession callable. Throws [SharingDataException] with [SharingDataException.linkOpened] once the link was opened; a session already gone counts as done. */
    suspend fun discard(sessionId: String)

    /** shareSessions/{id}, live. An error ends the flow with [RemoteSession.Failed]. */
    fun observe(sessionId: String): Flow<RemoteSession>

    /**
     * One batch: the ping (when there is one, with last_fix_at set to its recorded_at) and the check-in.
     * Suspends until the server confirms it; offline, Firestore keeps it queued and this keeps waiting.
     */
    suspend fun write(sessionId: String, ping: PingWrite?, checkIn: CheckInWrite)

    /**
     * last_ping_at and last_fix_at read from the server (never the cache): a server timestamp for
     * [live.trackme.app.domain.ServerClock], and whether a ping whose answer was lost landed after all.
     */
    suspend fun serverMarks(sessionId: String): ServerMarks

    /** precision_next: a precision for the next ping, or null to cancel a pending change. */
    suspend fun setPrecisionNext(sessionId: String, precision: Precision?)

    /** The timer sheet's new stop rule. Needs the server: offline it fails with [SharingFailure.Network]. */
    suspend fun setStop(sessionId: String, stop: StopWrite)
}

class SharingDataException(
    val reason: SharingFailure,
    cause: Throwable? = null,
    /** createSession: the session already running (already-exists, reason active_session). */
    val activeSessionId: String? = null,
    /** discardSession: the link was opened, so the session can't be discarded. */
    val linkOpened: Boolean = false,
) : Exception(reason.name, cause)
