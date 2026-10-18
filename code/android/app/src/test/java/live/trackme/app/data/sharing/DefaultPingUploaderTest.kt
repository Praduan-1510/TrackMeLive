package live.trackme.app.data.sharing

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.domain.BatteryReading
import live.trackme.app.domain.PingCadence
import live.trackme.app.domain.ServerClock
import live.trackme.app.fakes.FakeClock
import live.trackme.app.fakes.FakeLocationUpdates
import live.trackme.app.fakes.FakeSessionDataSource
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import live.trackme.schema.TmlSchemaConstants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** On Robolectric only for android.util.Log; time is the test scheduler's throughout. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DefaultPingUploaderTest {
    private val start = FakeSharingRepository.START_MILLIS

    /** Everything one run needs, on the test scheduler: elapsed 0 is server time [start]. */
    private inner class Harness(val scope: TestScope, precision: Precision = Precision.PRECISE, stop: StopChoice = StopChoice.After(StopMinutes.MINUTES_30), synced: Boolean = true) {
        val clock = FakeClock(scope.testScheduler)
        var wall = start + 3 * 3_600_000L // the phone's own clock, three hours fast
        val serverClock = ServerClock(clock) { wall + clock.elapsedMillis() }.also { if (synced) it.observe(start, 0) }
        val location = FakeLocationUpdates()
        val source = FakeSessionDataSource { serverClock.nowMillis() }
        var battery = 80
        val request = ShareRequest(stop, precision, shareBackAllowed = false)
        val share = FakeSharingRepository.shareFor(request, startedAt = start)
        val session = MutableStateFlow<SessionView?>(FakeSharingRepository.sessionFor(share, request))
        val syncedOffsets = mutableListOf<Long>()
        val uploader = DefaultPingUploader(location, source, { BatteryReading(battery) }, serverClock, clock, onClockSynced = { syncedOffsets += it })
        lateinit var job: Job

        fun begin(): Harness {
            job = scope.backgroundScope.launch { uploader.run(share, session) }
            scope.runCurrent()
            return this
        }

        /** A fix taken now. */
        fun fix(lat: Double = 37.8044, lng: Double = -122.2712, accuracy: Double = 12.0, speed: Double? = 0.0, ageMillis: Long = 0) {
            location.send(FakeLocationUpdates.fix(clock.elapsedMillis() - ageMillis, lat, lng, accuracy, speed))
            scope.runCurrent()
        }

        /** A fix every second for [seconds]. */
        fun fixesEverySecond(seconds: Int, speed: Double? = 0.0) {
            repeat(seconds) {
                fix(lat = 37.8044 + it * 0.0001, speed = speed)
                scope.advanceTimeBy(1_000)
                scope.runCurrent()
            }
        }

        val pings get() = source.writes.mapNotNull { it.ping }
    }

    private fun TestScope.harness(precision: Precision = Precision.PRECISE, stop: StopChoice = StopChoice.After(StopMinutes.MINUTES_30), synced: Boolean = true) =
        Harness(this, precision, stop, synced).begin()

    @Test
    fun `nothing is written before the session doc is known`() = runTest {
        val h = Harness(this)
        h.session.value = null
        h.begin()
        h.fix()
        advanceTimeBy(60_000)
        assertEquals(0, h.source.writesStarted)
        assertFalse(h.location.isListening.value)
    }

    @Test
    fun `still, above 20 percent, a ping about every 5 s with the server's time`() = runTest {
        val h = harness()
        h.fixesEverySecond(20)
        val pings = h.pings
        assertEquals(5, pings.size)
        // recorded_at is server time: elapsed plus the server's offset, never the phone's fast clock.
        assertEquals(start, pings.first().recordedAtMillis)
        pings.zipWithNext().forEach { (a, b) -> assertTrue(b.recordedAtMillis - a.recordedAtMillis >= 4_000) }
        assertEquals(5.0, h.uploader.status.value.intervalSeconds, 0.0)
        // Every ping carries a check-in; ping_interval_s stays as createSession wrote it (5).
        assertTrue(h.source.writes.all { it.checkIn.pingIntervalSeconds == null })
        assertEquals(GpsSignal.Ok, h.uploader.status.value.signal)
    }

    @Test
    fun `moving pings every 3 s and writes the new interval once`() = runTest {
        val h = harness()
        h.fixesEverySecond(15, speed = 1.5)
        val pings = h.pings
        assertTrue("${pings.size} pings", pings.size >= 5)
        pings.zipWithNext().forEach { (a, b) -> assertTrue(b.recordedAtMillis - a.recordedAtMillis in 2_000..3_000) }
        assertEquals(3.0, h.uploader.status.value.intervalSeconds, 0.0)
        assertEquals(listOf(3.0), h.source.writes.mapNotNull { it.checkIn.pingIntervalSeconds })
        // Location is asked again at the new cadence.
        assertEquals(3_000L, h.location.requests.last().intervalMillis)
    }

    @Test
    fun `low battery pings every 15 s, critical every 60 s, with check-ins every 30 s between`() = runTest {
        val h = harness()
        h.battery = 15
        h.fixesEverySecond(46)
        assertEquals(15.0, h.uploader.status.value.intervalSeconds, 0.0)
        assertEquals(4, h.pings.size) // 0, 15, 30, 45 s
        assertTrue(h.source.writes.any { it.checkIn.pingIntervalSeconds == 15.0 })

        h.battery = 5
        h.fix()
        advanceTimeBy(1_000)
        h.source.writes.clear()
        // A minute of fixes: one ping, and a check-in alone at least every 30 s.
        h.fixesEverySecond(61)
        assertEquals(60.0, h.uploader.status.value.intervalSeconds, 0.0)
        assertEquals(1, h.pings.size)
        val times = h.source.writes.map { it.atServerMillis }
        assertTrue(times.zipWithNext().all { (a, b) -> b - a <= 30_000 })
        assertTrue(h.source.writes.any { it.ping == null })
    }

    @Test
    fun `without a fix it checks in every 30 s and says No GPS signal after 30 s`() = runTest {
        val h = harness()
        assertEquals(GpsSignal.Searching, h.uploader.status.value.signal)
        advanceTimeBy(29_000)
        runCurrent()
        assertEquals(0, h.source.writes.size)
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(GpsSignal.NoSignal, h.uploader.status.value.signal)
        assertEquals(1, h.source.writes.size)
        assertNull(h.source.writes.single().ping)
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(3, h.source.writes.size)
    }

    @Test
    fun `a fix of 100 m or worse is written but isn't a GPS signal`() = runTest {
        val h = harness()
        h.fix(accuracy = 150.0)
        advanceTimeBy(31_000)
        runCurrent()
        assertEquals(150.0, h.pings.single().accuracyM, 0.0)
        assertEquals(GpsSignal.NoSignal, h.uploader.status.value.signal)
    }

    @Test
    fun `approximate rounds each point to about 500 m with accuracy at least 500`() = runTest {
        val h = harness(precision = Precision.APPROXIMATE)
        h.fix(lat = 37.80441, lng = -122.27123, accuracy = 8.0)
        val ping = h.pings.single()
        val moved = PingCadence.distanceMeters(37.80441, -122.27123, ping.lat, ping.lng)
        assertTrue(moved in 1.0..360.0)
        assertEquals(500.0, ping.accuracyM, 0.0)
        assertEquals(Precision.APPROXIMATE, h.uploader.status.value.lastPoint?.precision)
        assertEquals(ping.lat, h.uploader.status.value.lastPoint!!.lat, 0.0)
    }

    @Test
    fun `a precision change is applied by the next ping, in the same batch`() = runTest {
        val h = harness()
        h.fix()
        h.session.value = h.session.value!!.copy(precisionNext = Precision.APPROXIMATE)
        runCurrent()
        advanceTimeBy(5_000)
        h.fix(accuracy = 8.0)
        val write = h.source.writes.last()
        assertEquals(Precision.APPROXIMATE, write.checkIn.applyPrecision)
        assertEquals(500.0, write.ping!!.accuracyM, 0.0)
        // A check-in alone never applies it.
        assertTrue(h.source.writes.filter { it.ping == null }.none { it.checkIn.applyPrecision != null })
    }

    @Test
    fun `it stops writing at expires_at, on the server's clock, and stops listening`() = runTest {
        val h = harness(stop = StopChoice.AtLimit)
        h.fix()
        advanceTimeBy(60 * 60_000L - 10_000)
        runCurrent()
        val before = h.source.writesStarted
        h.fix()
        advanceTimeBy(10_000)
        runCurrent()
        assertTrue(h.job.isCompleted)
        assertFalse(h.location.isListening.value)
        val after = h.source.writesStarted
        h.fix()
        advanceTimeBy(120_000)
        assertEquals(after, h.source.writesStarted)
        assertTrue(after - before <= 1)
        assertTrue(h.source.writes.all { it.atServerMillis < start + 60 * 60_000L })
        assertEquals(UploadStatus.Initial, h.uploader.status.value)
    }

    @Test
    fun `it stops at a timer's stop_at`() = runTest {
        val h = harness(stop = StopChoice.After(StopMinutes.MINUTES_15))
        advanceTimeBy(15 * 60_000L)
        runCurrent()
        assertTrue(h.job.isCompleted)
        assertTrue(h.source.writes.all { it.atServerMillis < start + 15 * 60_000L })
    }

    @Test
    fun `it stops the moment the session doc says it ended`() = runTest {
        val h = harness()
        h.fix()
        val written = h.source.writesStarted
        h.session.value = h.session.value!!.copy(active = false, endReason = EndReason.STOPPED, endedAtMillis = start + 1_000)
        runCurrent()
        assertTrue(h.job.isCompleted)
        h.fix()
        advanceTimeBy(60_000)
        assertEquals(written, h.source.writesStarted)
    }

    @Test
    fun `cancelled (Stop), nothing more is written`() = runTest {
        val h = harness()
        h.fix()
        h.job.cancel()
        runCurrent()
        val written = h.source.writesStarted
        h.fixesEverySecond(60)
        assertEquals(written, h.source.writesStarted)
        assertFalse(h.location.isListening.value)
    }

    @Test
    fun `offline, one write waits and newer fixes replace each other, never a pile-up`() = runTest {
        val h = harness()
        val gate = CompletableDeferred<Unit>()
        h.source.writeGate = gate
        h.fix()
        advanceTimeBy(10_001)
        runCurrent()
        assertTrue(h.uploader.status.value.offline)
        h.fixesEverySecond(120)
        assertEquals(1, h.source.writesStarted)
        h.source.writeGate = null
        gate.complete(Unit)
        runCurrent()
        assertFalse(h.uploader.status.value.offline)
        advanceTimeBy(1_000)
        runCurrent()
        // The queued one, then the newest fix straight away; nothing in between.
        assertEquals(2, h.pings.size)
        val (queued, newest) = h.pings
        assertEquals(start, queued.recordedAtMillis)
        assertTrue(newest.recordedAtMillis >= start + 129_000)
    }

    @Test
    fun `a failed write is retried with backoff`() = runTest {
        val h = harness()
        h.source.writeFailure = SharingDataException(SharingFailure.Other)
        h.fix()
        assertEquals(1, h.source.writesStarted)
        advanceTimeBy(1_999)
        h.fix()
        assertEquals(1, h.source.writesStarted)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(2, h.source.writesStarted) // after 2 s
        advanceTimeBy(4_000)
        runCurrent()
        assertEquals(3, h.source.writesStarted) // then 4 s
        h.source.writeFailure = null
        advanceTimeBy(8_000)
        runCurrent()
        assertEquals(1, h.pings.size)
    }

    @Test
    fun `a refused retry of a ping that already landed counts as written`() = runTest {
        val h = harness()
        h.fix()
        advanceTimeBy(5_000)
        // The batch lands but its answer is lost; sent again, the rules refuse it, and last_fix_at shows it landed.
        h.source.writeFailure = SharingDataException(SharingFailure.NotSharing)
        h.source.marks = { ServerMarks(start + 5_000, lastFixAtMillis = start + 5_000) }
        h.fix()
        assertEquals(2, h.source.writesStarted)
        assertEquals(1, h.source.markReads)
        assertEquals(start + 5_000, h.uploader.status.value.lastPoint?.recordedAtMillis)
        // Not retried (a retry would come after 2 s), and no error shows.
        h.source.writeFailure = null
        advanceTimeBy(4_000)
        runCurrent()
        assertEquals(2, h.source.writesStarted)
        assertFalse(h.uploader.status.value.offline)
    }

    @Test
    fun `a refused ping that didn't land is retried`() = runTest {
        val h = harness()
        h.source.marks = { ServerMarks(start, lastFixAtMillis = null) }
        h.source.writeFailure = SharingDataException(SharingFailure.NotSharing)
        h.fix()
        assertEquals(1, h.source.markReads)
        h.source.writeFailure = null
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(1, h.pings.size)
    }

    @Test
    fun `pings stay at least 2 s after last_fix_at, from before a restart too`() = runTest {
        val h = Harness(this)
        h.session.value = h.session.value!!.copy(lastFixAtMillis = start + 10_000)
        h.begin()
        advanceTimeBy(11_000)
        h.fix() // recorded at start + 11 s: under 2 s after last_fix_at, dropped
        assertEquals(0, h.pings.size)
        advanceTimeBy(1_000)
        h.fix() // start + 12 s: exactly 2 s after, written
        assertEquals(start + 12_000, h.pings.single().recordedAtMillis)
        assertEquals(TmlSchemaConstants.MIN_PING_SPACING_SECONDS * 1000L, h.pings.single().recordedAtMillis - (start + 10_000))
    }

    @Test
    fun `fixes the rules refuse are dropped - too vague, or from before the session`() = runTest {
        val h = harness()
        h.fix(accuracy = TmlSchemaConstants.MAX_ACCURACY_METERS + 1.0)
        assertEquals(0, h.pings.size)
        advanceTimeBy(6 * 60_000L)
        runCurrent()
        // Taken 12 minutes ago: 6 minutes before the session started, past the 5 allowed.
        h.fix(ageMillis = 12 * 60_000L)
        assertEquals(0, h.pings.size)
        h.fix()
        assertEquals(1, h.pings.size)
    }

    @Test
    fun `after a reboot it checks in first to learn the server's time, then pings`() = runTest {
        val h = Harness(this, synced = false)
        // The phone's clock says the session ended hours ago; only the server's time counts.
        h.source.marks = { ServerMarks(lastPingAtMillis = start, lastFixAtMillis = null) }
        h.begin()
        h.fix()
        val first = h.source.writes.first()
        assertNull(first.ping)
        assertTrue(h.serverClock.synced)
        assertEquals(listOf(start), h.syncedOffsets)
        // Then the fix, stamped with server time, not the phone's clock three hours ahead.
        assertEquals(start, h.pings.single().recordedAtMillis)
        assertEquals(2, h.source.writes.size)
    }

    @Test
    fun `without location permission it keeps checking in`() = runTest {
        val h = Harness(this)
        h.location.permissionMissing = true
        h.begin()
        advanceTimeBy(61_000)
        runCurrent()
        assertEquals(GpsSignal.NoSignal, h.uploader.status.value.signal)
        assertEquals(2, h.source.writes.size)
        assertTrue(h.source.writes.all { it.ping == null })
    }
}
