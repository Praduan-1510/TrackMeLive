package live.trackme.app.domain

import java.time.LocalTime

/** Time, injectable so countdowns and greetings are testable. */
interface Clock {
    /** Monotonic milliseconds (never jumps with the wall clock), for countdowns. */
    fun elapsedMillis(): Long

    /** The local wall-clock time, for the greeting. */
    fun localTime(): LocalTime
}

object SystemClock : Clock {
    override fun elapsedMillis(): Long = android.os.SystemClock.elapsedRealtime()

    override fun localTime(): LocalTime = LocalTime.now()
}
