package live.trackme.app.fakes

import java.time.LocalTime
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import live.trackme.app.domain.Clock

/** Time from the test scheduler, so delay() and the clock move together. */
@OptIn(ExperimentalCoroutinesApi::class)
class FakeClock(
    private val scheduler: TestCoroutineScheduler,
    private val startTime: LocalTime = LocalTime.of(20, 0),
) : Clock {
    override fun elapsedMillis(): Long = scheduler.currentTime

    override fun localTime(): LocalTime = startTime.plusNanos(scheduler.currentTime * 1_000_000)
}
