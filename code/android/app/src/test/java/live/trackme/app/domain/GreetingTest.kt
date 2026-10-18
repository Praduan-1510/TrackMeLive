package live.trackme.app.domain

import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Test

class GreetingTest {
    @Test
    fun followsTheTimeOfDay() {
        assertEquals(Greeting.Evening, Greeting.at(LocalTime.of(4, 59)))
        assertEquals(Greeting.Morning, Greeting.at(LocalTime.of(5, 0)))
        assertEquals(Greeting.Morning, Greeting.at(LocalTime.of(11, 59)))
        assertEquals(Greeting.Afternoon, Greeting.at(LocalTime.NOON))
        assertEquals(Greeting.Evening, Greeting.at(LocalTime.of(18, 0)))
        assertEquals(Greeting.Evening, Greeting.at(LocalTime.of(23, 59)))
    }

    @Test
    fun knowsWhenItNextChanges() {
        assertEquals(60_000, Greeting.millisUntilNextChange(LocalTime.of(11, 59)))
        assertEquals(6 * 3_600_000L, Greeting.millisUntilNextChange(LocalTime.NOON))
        assertEquals(5 * 3_600_000L + 60_000, Greeting.millisUntilNextChange(LocalTime.of(23, 59)))
    }
}
