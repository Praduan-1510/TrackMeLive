package live.trackme.app.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class ResendCountdownTest {
    @Test
    fun countsDownFromThirtyRoundingUp() {
        assertEquals(30, ResendCountdown.secondsLeft(sentAtMillis = 0, nowMillis = 0))
        assertEquals(30, ResendCountdown.secondsLeft(0, 1))
        assertEquals(29, ResendCountdown.secondsLeft(0, 1_000))
        assertEquals(1, ResendCountdown.secondsLeft(0, 29_999))
        assertEquals(0, ResendCountdown.secondsLeft(0, 30_000))
        assertEquals(0, ResendCountdown.secondsLeft(0, 90_000))
        // A clock that reads earlier than the send (it never should) still shows 0:30, not more.
        assertEquals(30, ResendCountdown.secondsLeft(5_000, 0))
    }

    @Test
    fun wakesExactlyOnEachSecond() {
        assertEquals(1_000, ResendCountdown.millisToNextTick(0, 0))
        assertEquals(999, ResendCountdown.millisToNextTick(0, 1))
        assertEquals(250, ResendCountdown.millisToNextTick(0, 750))
    }

    @Test
    fun labelIsMinutesAndTwoDigitSeconds() {
        assertEquals("0:30", ResendCountdown.label(30))
        assertEquals("0:05", ResendCountdown.label(5))
        assertEquals("1:00", ResendCountdown.label(60))
    }
}
