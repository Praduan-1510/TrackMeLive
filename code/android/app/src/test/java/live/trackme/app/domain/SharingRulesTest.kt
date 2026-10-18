package live.trackme.app.domain

import java.time.LocalTime
import live.trackme.schema.Precision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerClockTest {
    private var elapsed = 10_000L
    private var wall = 1_000_000L
    private val clock = object : Clock {
        override fun elapsedMillis() = elapsed
        override fun localTime(): LocalTime = LocalTime.NOON
    }

    @Test
    fun `before any server answer it falls back to the phone's clock`() {
        val server = ServerClock(clock) { wall }
        assertFalse(server.synced)
        assertEquals(1_000_000L, server.nowMillis())
        assertEquals(995_000L, server.millisAt(5_000))
    }

    @Test
    fun `a server timestamp replaces the phone's clock, even a phone clock that is hours off`() {
        val server = ServerClock(clock) { wall }
        wall = 9_999_999_999L // set by hand, far in the future
        // Request sent at elapsed 10 000; the server stamped 5 000 000 while handling it.
        server.observe(serverMillis = 5_000_000, sentAtElapsedMillis = 10_000)
        assertTrue(server.synced)
        elapsed = 70_000
        assertEquals(5_060_000L, server.nowMillis())
    }

    @Test
    fun `the estimate leans late, never early, and keeps the tightest bound`() {
        val server = ServerClock(clock) { wall }
        // True offset: server = elapsed + 1 000 000. A request sent at 10 000 reached the server 300 ms later.
        server.observe(serverMillis = 1_010_300, sentAtElapsedMillis = 10_000)
        assertEquals(1_000_300L, server.offsetMillis)
        // A quicker round trip later tightens it; a slower one doesn't loosen it.
        server.observe(serverMillis = 1_020_050, sentAtElapsedMillis = 20_000)
        server.observe(serverMillis = 1_032_000, sentAtElapsedMillis = 30_000)
        assertEquals(1_000_050L, server.offsetMillis)
        elapsed = 40_000
        assertTrue(server.nowMillis() >= 1_040_000)
    }

    @Test
    fun `a restored offset is used and still tightens`() {
        val server = ServerClock(clock) { wall }
        server.restore(2_000_000)
        assertTrue(server.synced)
        assertEquals(2_010_000L, server.nowMillis())
        server.observe(serverMillis = 2_009_000, sentAtElapsedMillis = 10_000)
        assertEquals(1_999_000L, server.offsetMillis)
    }
}

class PingCadenceTest {
    private fun interval(percent: Int?, moving: Boolean = false, accuracy: Double? = 10.0, precision: Precision = Precision.PRECISE) =
        PingCadence.intervalSeconds(BatteryReading(percent), moving, accuracy, precision)

    @Test
    fun `above 20 percent it pings every 3 s moving and every 5 s still`() {
        assertEquals(3.0, interval(80, moving = true), 0.0)
        assertEquals(5.0, interval(80, moving = false), 0.0)
        assertEquals(3.0, interval(21, moving = true), 0.0)
    }

    @Test
    fun `from 20 to 10 percent every 15 s, and under 10 percent every 60 s`() {
        assertEquals(15.0, interval(20, moving = true), 0.0)
        assertEquals(15.0, interval(10, moving = true), 0.0)
        assertEquals(60.0, interval(9, moving = true), 0.0)
        assertEquals(60.0, interval(1), 0.0)
    }

    @Test
    fun `never slower than once a minute`() {
        for (percent in listOf(null, 0, 1, 5, 9, 10, 15, 20, 21, 50, 100)) {
            for (moving in listOf(true, false)) {
                for (accuracy in listOf(null, 5.0, 100.0, 5000.0)) {
                    for (precision in Precision.entries) {
                        val s = interval(percent, moving, accuracy, precision)
                        assertTrue("$percent $moving $accuracy $precision -> $s", s in 3.0..60.0)
                    }
                }
            }
        }
    }

    @Test
    fun `an unknown battery level counts as above 20 percent`() {
        assertEquals(3.0, interval(null, moving = true), 0.0)
    }

    @Test
    fun `a poor fix or no fix yet keeps the slower 5 s`() {
        assertEquals(5.0, interval(80, moving = true, accuracy = 100.0), 0.0)
        assertEquals(5.0, interval(80, moving = true, accuracy = null), 0.0)
        assertEquals(3.0, interval(80, moving = true, accuracy = 99.0), 0.0)
    }

    @Test
    fun `approximate pings every 5 s, the rounded point rarely changes`() {
        assertEquals(5.0, interval(80, moving = true, precision = Precision.APPROXIMATE), 0.0)
        assertEquals(15.0, interval(15, moving = true, precision = Precision.APPROXIMATE), 0.0)
    }

    @Test
    fun `fixes are asked at the battery step's fastest interval`() {
        assertEquals(3.0, PingCadence.fixIntervalSeconds(BatteryReading(50)), 0.0)
        assertEquals(15.0, PingCadence.fixIntervalSeconds(BatteryReading(15)), 0.0)
        assertEquals(60.0, PingCadence.fixIntervalSeconds(BatteryReading(5)), 0.0)
    }

    @Test
    fun `moving comes from the provider's speed when there is one`() {
        assertTrue(PingCadence.isMoving(1.4, null, 0.0 to 0.0, 0.0, 5.0, null))
        assertFalse(PingCadence.isMoving(0.3, 0.0 to 0.0, 1.0 to 1.0, 3.0, 5.0, 5.0))
    }

    @Test
    fun `without a speed, moving is distance over time, beyond the fixes' accuracy`() {
        // About 11 m north in 3 s: 3.7 m/s, more than 5 m accuracy.
        assertTrue(PingCadence.isMoving(null, 37.0 to -122.0, 37.0001 to -122.0, 3.0, 5.0, 5.0))
        // The same 11 m with 20 m accuracy is GPS wander.
        assertFalse(PingCadence.isMoving(null, 37.0 to -122.0, 37.0001 to -122.0, 3.0, 20.0, 5.0))
        // 11 m in 60 s is standing still.
        assertFalse(PingCadence.isMoving(null, 37.0 to -122.0, 37.0001 to -122.0, 60.0, 5.0, 5.0))
        // No earlier fix, or no time between them.
        assertFalse(PingCadence.isMoving(null, null, 37.0 to -122.0, 3.0, 5.0, null))
        assertFalse(PingCadence.isMoving(null, 37.0 to -122.0, 37.0001 to -122.0, 0.0, 5.0, 5.0))
    }

    @Test
    fun `distance is great-circle meters`() {
        assertEquals(111_195.0, PingCadence.distanceMeters(0.0, 0.0, 1.0, 0.0), 5.0)
        assertEquals(0.0, PingCadence.distanceMeters(37.8, -122.3, 37.8, -122.3), 0.0)
    }
}

class ApproximateLocationTest {
    @Test
    fun `a point moves at most about 350 m and lands on a fixed grid`() {
        val points = listOf(37.8044 to -122.2712, 51.5072 to -0.1276, -33.8688 to 151.2093, 19.076 to 72.8777, 0.0 to 0.0)
        for ((lat, lng) in points) {
            val r = ApproximateLocation.round(lat, lng)
            val moved = PingCadence.distanceMeters(lat, lng, r.lat, r.lng)
            assertTrue("$lat,$lng moved $moved m", moved <= 360.0)
            // The same cell gives the same point: rounding again changes nothing.
            assertEquals(r, ApproximateLocation.round(r.lat, r.lng))
        }
    }

    @Test
    fun `standing still gives the same point every time`() {
        val a = ApproximateLocation.round(37.80440, -122.27120)
        val b = ApproximateLocation.round(37.80452, -122.27101) // about 20 m away, same cell
        assertEquals(a, b)
    }

    @Test
    fun `cells are about 500 m apart`() {
        val a = ApproximateLocation.round(37.8044, -122.2712)
        val b = ApproximateLocation.round(37.8044 + 0.0045, -122.2712)
        // One cell north; the longitude step follows the latitude, so it's about, not exactly, 500 m.
        assertEquals(500.0, PingCadence.distanceMeters(a.lat, a.lng, b.lat, b.lng), 40.0)
    }

    @Test
    fun `the poles and the date line stay valid coordinates`() {
        for ((lat, lng) in listOf(90.0 to 10.0, -90.0 to -170.0, 89.9999 to 179.9999, 10.0 to 179.999, 10.0 to -179.999, -89.99 to 0.0)) {
            val r = ApproximateLocation.round(lat, lng)
            assertTrue("$r", r.lat in -90.0..90.0 && r.lng in -180.0..180.0)
        }
    }

    @Test
    fun `accuracy is at least 500 m`() {
        assertEquals(500.0, ApproximateLocation.accuracy(8.0), 0.0)
        assertEquals(1200.0, ApproximateLocation.accuracy(1200.0), 0.0)
    }

    @Test
    fun `no result is ever null or NaN`() {
        val r = ApproximateLocation.round(-45.123, 0.0001)
        assertNull(listOf(r.lat, r.lng).firstOrNull { it.isNaN() })
    }
}
