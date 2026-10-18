package live.trackme.app.domain

import live.trackme.schema.TmlSchemaConstants

/**
 * "You can send a new code in 0:30." (FSD §4 Sign up): a new code can be sent 30 seconds after the last
 * one. Times are monotonic milliseconds ([Clock.elapsedMillis]).
 */
object ResendCountdown {
    const val SECONDS: Int = TmlSchemaConstants.OTP_RESEND_SECONDS
    private const val PERIOD_MS: Long = SECONDS * 1000L

    /** Whole seconds until a new code can be sent, rounded up, from [SECONDS] down to 0. */
    fun secondsLeft(sentAtMillis: Long, nowMillis: Long): Int {
        val remaining = (sentAtMillis + PERIOD_MS - nowMillis).coerceIn(0, PERIOD_MS)
        return ((remaining + 999) / 1000).toInt()
    }

    /** How long until [secondsLeft] next changes, so a ticker wakes exactly on each second. */
    fun millisToNextTick(sentAtMillis: Long, nowMillis: Long): Long {
        val remaining = (sentAtMillis + PERIOD_MS - nowMillis).coerceIn(0, PERIOD_MS)
        val intoSecond = remaining % 1000
        return if (intoSecond == 0L) 1000 else intoSecond
    }

    /** The countdown as m:ss, e.g. 0:30, 0:05. */
    fun label(seconds: Int): String = "%d:%02d".format(java.util.Locale.ROOT, seconds / 60, seconds % 60)
}
