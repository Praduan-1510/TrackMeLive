package live.trackme.app.data.sharing

import kotlinx.coroutines.flow.StateFlow
import live.trackme.schema.Precision

/**
 * The share session client (FSD §4 Live map link, Stop sharing, Auto-expiry; §6): createSession, the
 * session doc live, Stop, and the share link. One share at a time.
 *
 * Flow for the share screen:
 *  1. [createSession] with the person's choices. It starts the location foreground service and the
 *     pings (so call it while the app is in the foreground), and returns the link.
 *  2. Open the system share sheet with [ActiveShare.linkUrl]. If it closes without a choice, call
 *     [discard]: the session is deleted before anyone can see it. Copy link counts as sent.
 *  3. While [state] is [ShareState.Live], the live screen reads the session from it; Send link again uses
 *     [ShareState.Live.share]'s link.
 *  4. Stop: [stop] (after the screen's confirmation dialog). The share also ends by itself at the timer,
 *     the 1-hour limit or the call's end; [state] turns [ShareState.Ended] with the reason either way,
 *     on time even when the phone is offline, judged by the server's clock ([serverNowMillis]).
 *  5. Done (or Share again) on the ended screen: [dismissEnded].
 *
 * The ongoing notification's Stop sharing opens the app to confirm: it sets
 * [stopConfirmationRequested]; the live screen shows its Stop dialog and calls
 * [consumeStopConfirmation].
 */
interface SharingRepository {
    val state: StateFlow<ShareState>

    /**
     * The server's clock, estimated on the phone from the server's own timestamps and the monotonic
     * clock, so a wrong phone clock can't move an end. Leans late by at most a round trip, so the phone
     * stops a little early rather than late. Use it for every countdown and "Sharing stops at" line.
     */
    fun serverNowMillis(): Long

    /**
     * Starts a share: the createSession callable, then the location service and the pings. Needs the
     * location permission and the app in the foreground. See [CreateShareResult].
     */
    suspend fun createSession(request: ShareRequest): CreateShareResult

    /** The share sheet closed without a choice: deletes the session (only before the link is opened). */
    suspend fun discard(): DiscardShareResult

    /**
     * Stops sharing now. Pings stop at once and [state] turns [ShareState.Ended] (stopped) before this
     * returns, even offline; the server is told in the background, with retries, and its answer
     * (which may say the timer or the limit ended it first) replaces the local end.
     */
    suspend fun stop(): ShareEnd?

    /**
     * Location detail changed mid-session (FSD §4): writes precision_next; the next ping applies it.
     * Changing back before that ping just clears it.
     */
    suspend fun setPrecision(precision: Precision): UpdateShareResult

    /** The timer sheet: a new stop rule, from now (capped at expires_at) for a timer. */
    suspend fun changeStop(choice: StopChoice): UpdateShareResult

    /** Leaves the ended screen: back to [ShareState.Idle] and forgets the share on this phone. */
    fun dismissEnded()

    /** True after the ongoing notification's Stop sharing, until the live screen has shown its dialog. */
    val stopConfirmationRequested: StateFlow<Boolean>

    fun requestStopConfirmation()

    fun consumeStopConfirmation()
}

/**
 * Hook for Backend-Alerts: registers this phone's push token (users/{uid}/devices/{deviceId}) so the
 * link-opened alert can reach it. Called right after each share is created, before the link is sent.
 * Until FCM is wired up it does nothing.
 */
fun interface PushRegistration {
    suspend fun ensureRegistered()

    companion object {
        val None = PushRegistration { }
    }
}
