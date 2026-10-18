package live.trackme.app.data.sharing

import kotlinx.coroutines.flow.StateFlow
import live.trackme.schema.Precision

/** A point as it was written: rounded to about 500 m while Approximate. */
data class SharedPoint(
    val lat: Double,
    val lng: Double,
    /** As written: at least 500 m while Approximate. */
    val accuracyM: Double,
    /** recorded_at, server time, epoch ms. "Last seen" uses this. */
    val recordedAtMillis: Long,
    val precision: Precision,
)

/** The phone's GPS, as the sharer's row shows it (FSD §7 Offline behavior). */
enum class GpsSignal {
    /** Sharing just started; no fix yet, and it's under 30 s. */
    Searching,

    /** A fix better than 100 m in the last 30 s. */
    Ok,

    /** No fix better than 100 m for 30 s: "No GPS signal". */
    NoSignal,
}

/** What the pings are doing, for the sharer's own row and the ongoing notification. */
data class UploadStatus(
    /** The interval in use, in seconds (FSD §7): 3 to 5 above 20% battery, 15 to 20% from 10%, 60 under 10%. */
    val intervalSeconds: Double,
    /** The precision pings are written at now. */
    val precision: Precision,
    /** The newest point written (or queued while offline), or null before the first. */
    val lastPoint: SharedPoint? = null,
    val signal: GpsSignal = GpsSignal.Searching,
    /** True while writes aren't reaching the server: "No connection". */
    val offline: Boolean = false,
) {
    companion object {
        val Initial = UploadStatus(intervalSeconds = 5.0, precision = Precision.PRECISE)
    }
}

/**
 * Writes the sharer's pings to shareSessions/{id}/pings while a share is live (FSD §6, §7).
 *
 * - Cadence: 3 to 60 s by battery, movement and accuracy (`domain/PingCadence`), written to the session
 *   as ping_interval_s whenever it changes. A check-in (last_ping_at, server time) goes with every ping,
 *   and every 30 s even without a fix.
 * - Precision: Approximate rounds each point to about 500 m on the phone, before it's written, with
 *   accuracy_m at least 500. A pending precision_next is applied by the next ping, in the same batch.
 * - Offline: one write in flight at a time; newer fixes replace a waiting one, and failed writes retry
 *   with backoff (2 s doubling to 60 s).
 * - The end: [run] stops writing the moment the share is no longer live (Stop, the session ending on the
 *   server, or stop_at / expires_at passing on the server's clock). The rules refuse any write after the
 *   end, so a write queued offline can never land after it either.
 */
interface PingUploader {
    /** The current run's status; [UploadStatus.Initial] between runs. */
    val status: StateFlow<UploadStatus>

    /**
     * Writes pings for [share] until it's no longer live or the caller is cancelled. [session] is the
     * session doc as observed (null until the first snapshot). Returns when the share is over.
     */
    suspend fun run(share: ActiveShare, session: StateFlow<SessionView?>)
}
