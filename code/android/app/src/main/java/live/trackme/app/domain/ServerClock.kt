package live.trackme.app.domain

/**
 * The server's clock, as the phone can know it (FSD §4 Auto-expiry: the session ends at the server's
 * stop_at or expires_at, and the rules judge by the server's time). The phone's wall clock can be wrong
 * by minutes or set by hand, so it's used only until the server has answered once.
 *
 * It keeps one number, the offset from the monotonic clock ([Clock.elapsedMillis], which doesn't jump
 * and keeps counting while the process is dead) to server time. Each server timestamp S produced by a
 * request sent at elapsed time t0 was taken at or after t0, so `S - t0` can only be at or above the true
 * offset. The clock keeps the smallest such bound. That makes its estimate lean late, by at most one
 * request's travel time, never early: the phone stops sharing a moment before the server would, never
 * after.
 */
class ServerClock(private val clock: Clock, private val wallMillis: () -> Long = System::currentTimeMillis) {
    @Volatile
    private var offset: Long? = null

    /** The offset in use (server minus elapsed), or null while it's still the phone's wall clock. */
    val offsetMillis: Long? get() = offset

    /** True once a server timestamp has been seen (or restored), so the wall clock is no longer used. */
    val synced: Boolean get() = offset != null

    /** Server time now, in epoch ms (the phone's clock until [synced]). */
    fun nowMillis(): Long = millisAt(clock.elapsedMillis())

    /**
     * Server time now, or null until a server timestamp has been seen. Ends are judged with this, so a
     * phone whose clock is wrong (after a reboot, before the first check-in) never ends a share early or
     * late: until then only the session doc's own status ends it.
     */
    fun syncedNowMillis(): Long? = if (synced) nowMillis() else null

    /** Server time, in epoch ms, at the monotonic time [elapsedMillis] (a location fix's time, for instance). */
    fun millisAt(elapsedMillis: Long): Long = elapsedMillis + (offset ?: (wallMillis() - clock.elapsedMillis()))

    /** A server timestamp [serverMillis] from a request sent at monotonic time [sentAtElapsedMillis]. */
    fun observe(serverMillis: Long, sentAtElapsedMillis: Long) {
        val bound = serverMillis - sentAtElapsedMillis
        offset = offset?.let { minOf(it, bound) } ?: bound
    }

    /** Brings back an offset saved earlier in this boot (the monotonic clock restarts at a reboot). */
    fun restore(offsetMillis: Long) {
        offset = offset?.let { minOf(it, offsetMillis) } ?: offsetMillis
    }
}
