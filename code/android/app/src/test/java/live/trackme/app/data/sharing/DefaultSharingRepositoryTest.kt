package live.trackme.app.data.sharing

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.domain.ServerClock
import live.trackme.app.fakes.FakeClock
import live.trackme.app.fakes.FakePingUploader
import live.trackme.app.fakes.FakeServiceController
import live.trackme.app.fakes.FakeSessionDataSource
import live.trackme.app.fakes.FakeShareStore
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import live.trackme.schema.StopRule
import live.trackme.schema.StopSessionResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** On Robolectric only for android.util.Log; time is the test scheduler's throughout. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DefaultSharingRepositoryTest {
    private val start = FakeSharingRepository.START_MILLIS
    private val timer30 = ShareRequest(StopChoice.After(StopMinutes.MINUTES_30), Precision.PRECISE, shareBackAllowed = false, viewerName = "Mom")

    private inner class Harness(
        val scope: TestScope,
        val store: FakeShareStore = FakeShareStore(),
        refuseService: Boolean = false,
        var permission: Boolean = true,
    ) {
        val clock = FakeClock(scope.testScheduler)

        /** The server's real clock: [start] at elapsed 0. The phone's own clock is two hours fast. */
        fun server() = start + clock.elapsedMillis()
        val serverClock = ServerClock(clock) { server() + 2 * 3_600_000L }
        val source = FakeSessionDataSource(::server)
        val uploader = FakePingUploader()
        val service = FakeServiceController().also { it.refuse = refuseService }
        val userId = MutableStateFlow<String?>("alex")

        /** Who is signed in right now (AuthRepository.currentUserId); [userId] can trail it. */
        var current: String? = "alex"

        fun signOut() {
            current = null
            userId.value = null
        }
        var pushes = 0
        var signInEnded = 0
        val repo = DefaultSharingRepository(
            userId = userId,
            currentUserId = { current },
            source = source,
            uploader = uploader,
            store = store,
            service = service,
            serverClock = serverClock,
            clock = clock,
            scope = scope.backgroundScope,
            hasLocationPermission = { permission },
            push = { pushes++ },
            onSignInEnded = { signInEnded++ },
        )

        val state get() = repo.state.value

        /** The session doc as createSession wrote it, delivered to the listener. */
        fun deliverCreated(request: ShareRequest = timer30) {
            val share = (state as? ShareState.Live)?.share ?: (state as ShareState.Ended).share
            source.deliver(FakeSharingRepository.sessionFor(share, request))
            scope.runCurrent()
        }

        suspend fun create(request: ShareRequest = timer30): CreateShareResult {
            val result = repo.createSession(request)
            scope.runCurrent()
            return result
        }
    }

    private fun TestScope.harness(store: FakeShareStore = FakeShareStore()) = Harness(this, store).also { runCurrent() }

    // ---- Starting --------------------------------------------------------

    @Test
    fun `a new share starts the service and the pings and returns the link`() = runTest {
        val h = harness()
        val result = h.create() as CreateShareResult.Created
        assertEquals("http://10.0.2.2:5002/s/AAAAAAAAAAAAAAAAAAAAAA", result.share.linkUrl)
        assertEquals("Mom", result.share.viewerName)
        assertEquals(start, result.share.startedAtMillis)
        assertEquals(start + 3_600_000L, result.share.expiresAtMillis)
        assertTrue(h.state is ShareState.Live)
        assertEquals(1, h.service.starts)
        assertEquals(1, h.uploader.running)
        assertEquals(result.share, h.store.stored?.share)
        assertEquals("alex", h.store.stored?.userId)
        assertEquals(1, h.pushes)
        assertEquals(listOf(timer30), h.source.creates)
        // The server's time, not the phone's clock two hours fast.
        assertEquals(h.server(), h.repo.serverNowMillis())
        assertEquals(start, h.store.offset)
    }

    @Test
    fun `one share at a time`() = runTest {
        val h = harness()
        h.create()
        assertEquals(CreateShareResult.AlreadySharing("session-1"), h.create())
        assertEquals(1, h.source.creates.size)
    }

    @Test
    fun `the server saying another share runs gives that share's id`() = runTest {
        val h = harness()
        h.source.onCreate = { throw SharingDataException(SharingFailure.Other, activeSessionId = "elsewhere") }
        assertEquals(CreateShareResult.AlreadySharing("elsewhere"), h.create())
        assertEquals(ShareState.Idle, h.state)
    }

    @Test
    fun `following the call needs a call, and nothing reaches the server without one`() = runTest {
        val h = harness()
        val result = h.create(timer30.copy(stop = StopChoice.WhenCallEnds))
        assertEquals(CreateShareResult.Failed(SharingFailure.Invalid), result)
        assertTrue(h.source.creates.isEmpty())
    }

    @Test
    fun `without location nothing starts`() = runTest {
        val h = harness()
        h.permission = false
        assertEquals(CreateShareResult.Failed(SharingFailure.LocationPermission), h.create())
        assertTrue(h.source.creates.isEmpty())
        assertEquals(0, h.service.starts)
    }

    @Test
    fun `signed out, nothing starts`() = runTest {
        val h = harness()
        h.signOut()
        assertEquals(CreateShareResult.Failed(SharingFailure.NotSignedIn), h.create())
    }

    @Test
    fun `a failed createSession leaves nothing running`() = runTest {
        val h = harness()
        h.source.onCreate = { throw SharingDataException(SharingFailure.Network) }
        assertEquals(CreateShareResult.Failed(SharingFailure.Network), h.create())
        assertEquals(ShareState.Idle, h.state)
        assertEquals(0, h.service.starts)
        assertEquals(0, h.uploader.running)
        assertNull(h.store.stored)
    }

    @Test
    fun `an ended sign-in signs out`() = runTest {
        val h = harness()
        h.source.onCreate = { throw SharingDataException(SharingFailure.SignInEnded) }
        assertEquals(CreateShareResult.Failed(SharingFailure.SignInEnded), h.create())
        assertEquals(1, h.signInEnded)
    }

    @Test
    fun `right after signing in, before the observed sign-in catches up, a share starts and stays`() = runTest {
        val h = harness()
        h.signOut()
        runCurrent()
        // Signed in: the settled answer has the new account, the observed one is still on its way.
        h.current = "sam"
        val result = h.create()
        assertTrue(result is CreateShareResult.Created)
        assertEquals("sam", h.store.stored?.userId)
        h.userId.value = "sam"
        runCurrent()
        assertTrue(h.state is ShareState.Live)
        assertEquals(1, h.uploader.running)
    }

    @Test
    fun `when Android refuses the service, the new session is taken back`() = runTest {
        val h = harness()
        h.service.refuse = true
        assertEquals(CreateShareResult.Failed(SharingFailure.NotInForeground), h.create())
        assertEquals(listOf("session-1"), h.source.discards)
        assertEquals(ShareState.Idle, h.state)
        assertNull(h.store.stored)
        assertEquals(0, h.uploader.running)
    }

    // ---- Ending by itself ------------------------------------------------

    @Test
    fun `a timer ends the share on time, on the server's clock, even with no word from the server`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        advanceTimeBy(30 * 60_000L - 1)
        runCurrent()
        assertTrue(h.state is ShareState.Live)
        advanceTimeBy(1)
        runCurrent()
        val ended = h.state as ShareState.Ended
        assertEquals(ShareEnd(EndReason.TIMER, start + 30 * 60_000L, confirmed = false), ended.end)
        assertEquals(0, h.uploader.running)
        assertFalse(h.service.isRunning)
    }

    @Test
    fun `the 1-hour limit ends it, even before any snapshot arrives`() = runTest {
        val h = harness()
        h.create(timer30.copy(stop = StopChoice.AtLimit))
        advanceTimeBy(60 * 60_000L)
        runCurrent()
        assertEquals(ShareEnd(EndReason.LIMIT, start + 3_600_000L, confirmed = false), (h.state as ShareState.Ended).end)
        assertEquals(0, h.uploader.running)
    }

    @Test
    fun `a stop_at equal to expires_at is the limit`() = runTest {
        val h = harness()
        h.create(timer30.copy(stop = StopChoice.AtLimit))
        h.deliverCreated(timer30.copy(stop = StopChoice.AtLimit))
        advanceTimeBy(60 * 60_000L)
        runCurrent()
        assertEquals(EndReason.LIMIT, (h.state as ShareState.Ended).end.reason)
    }

    @Test
    fun `the server's end replaces the phone's`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        advanceTimeBy(30 * 60_000L)
        runCurrent()
        val live = FakeSharingRepository.sessionFor((h.state as ShareState.Ended).share, timer30)
        h.source.deliver(live.copy(active = false, endReason = EndReason.TIMER, endedAtMillis = start + 30 * 60_000L))
        runCurrent()
        assertEquals(ShareEnd(EndReason.TIMER, start + 30 * 60_000L, confirmed = true), (h.state as ShareState.Ended).end)
    }

    @Test
    fun `an end written by the server (the call, or Stop on another phone) ends it at once`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        advanceTimeBy(60_000)
        val live = (h.state as ShareState.Live).session!!
        h.source.deliver(live.copy(active = false, endReason = EndReason.CALL, endedAtMillis = start + 60_000))
        runCurrent()
        assertEquals(ShareEnd(EndReason.CALL, start + 60_000, confirmed = true), (h.state as ShareState.Ended).end)
        assertEquals(0, h.uploader.running)
        assertFalse(h.service.isRunning)
    }

    @Test
    fun `a phone clock hours fast doesn't end a share early`() = runTest {
        val h = harness()
        h.create(timer30.copy(stop = StopChoice.After(StopMinutes.MINUTES_15)))
        h.deliverCreated(timer30.copy(stop = StopChoice.After(StopMinutes.MINUTES_15)))
        advanceTimeBy(14 * 60_000L)
        runCurrent()
        assertTrue(h.state is ShareState.Live)
    }

    // ---- Stop --------------------------------------------------------------

    @Test
    fun `Stop ends it at once, before the server answers, then takes the server's end`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        advanceTimeBy(5 * 60_000L)
        val end = h.repo.stop()
        assertEquals(ShareEnd(EndReason.STOPPED, start + 5 * 60_000L, confirmed = false), end)
        assertTrue(h.state is ShareState.Ended)
        assertEquals(0, h.uploader.running)
        assertFalse(h.service.isRunning)
        runCurrent()
        assertEquals(listOf("session-1"), h.source.stops)
        assertEquals(ShareEnd(EndReason.STOPPED, start + 5 * 60_000L, confirmed = true), (h.state as ShareState.Ended).end)
    }

    @Test
    fun `offline, Stop still stops at once and tells the server when it can`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        var failures = 2
        h.source.onStop = {
            if (failures-- > 0) throw SharingDataException(SharingFailure.Network)
            StopSessionResponse(it, start, EndReason.STOPPED)
        }
        h.repo.stop()
        runCurrent()
        assertEquals(1, h.source.stops.size)
        assertFalse((h.state as ShareState.Ended).end.confirmed)
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(2, h.source.stops.size)
        advanceTimeBy(4_000)
        runCurrent()
        assertEquals(3, h.source.stops.size)
        assertTrue((h.state as ShareState.Ended).end.confirmed)
    }

    @Test
    fun `when the server says the limit came first, the end says so`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        h.source.onStop = { StopSessionResponse(it, start + 3_600_000L, EndReason.LIMIT) }
        h.repo.stop()
        runCurrent()
        assertEquals(EndReason.LIMIT, (h.state as ShareState.Ended).end.reason)
    }

    @Test
    fun `Stop when not sharing does nothing`() = runTest {
        val h = harness()
        assertNull(h.repo.stop())
        assertTrue(h.source.stops.isEmpty())
    }

    // ---- The share sheet closed without a choice --------------------------

    @Test
    fun `discard deletes the session and goes back to Idle`() = runTest {
        val h = harness()
        h.create()
        assertEquals(DiscardShareResult.Discarded, h.repo.discard())
        assertEquals(ShareState.Idle, h.state)
        assertNull(h.store.stored)
        assertEquals(0, h.uploader.running)
        assertFalse(h.service.isRunning)
        runCurrent()
        assertEquals(0, h.source.listeners)
    }

    @Test
    fun `a link already opened can't be discarded, so the share goes on`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        h.source.onDiscard = { throw SharingDataException(SharingFailure.Other, linkOpened = true) }
        assertEquals(DiscardShareResult.LinkOpened, h.repo.discard())
        runCurrent()
        assertTrue(h.state is ShareState.Live)
        assertEquals(1, h.uploader.running)
        assertTrue(h.service.isRunning)
    }

    @Test
    fun `offline, a discard still stops sharing and stops it on the server later`() = runTest {
        val h = harness()
        h.create()
        h.source.onDiscard = { throw SharingDataException(SharingFailure.Network) }
        assertEquals(DiscardShareResult.Failed(SharingFailure.Network), h.repo.discard())
        assertEquals(ShareState.Idle, h.state)
        assertEquals(0, h.uploader.running)
        runCurrent()
        // Tried once more, then stopped instead.
        assertEquals(2, h.source.discards.size)
        assertEquals(listOf("session-1"), h.source.stops)
    }

    // ---- Done, Share again ---------------------------------------------------

    @Test
    fun `Done forgets the share, and Share again starts a new one`() = runTest {
        val h = harness()
        h.create()
        h.repo.stop()
        runCurrent()
        h.repo.dismissEnded()
        assertEquals(ShareState.Idle, h.state)
        assertNull(h.store.stored)

        h.create()
        h.repo.stop()
        runCurrent()
        h.source.onCreate = { h.source.response(sessionId = "session-2") }
        val again = h.create() as CreateShareResult.Created
        assertEquals("session-2", again.share.sessionId)
        assertTrue(h.state is ShareState.Live)
    }

    // ---- After the process was killed ------------------------------------------

    @Test
    fun `a kept share picks up again, pings and service included`() = runTest {
        val share = FakeSharingRepository.shareFor(timer30, startedAt = start)
        val h = harness(FakeShareStore(StoredShare("alex", share), offset = start))
        assertTrue(h.state is ShareState.Live)
        h.deliverCreated()
        assertEquals(share, (h.state as ShareState.Live).share)
        assertEquals(1, h.uploader.running)
        assertEquals(1, h.service.starts)
        // The offset kept from this boot: server time without asking.
        assertEquals(h.server(), h.repo.serverNowMillis())
    }

    @Test
    fun `a kept share that ended meanwhile shows as ended`() = runTest {
        val share = FakeSharingRepository.shareFor(timer30, startedAt = start)
        val h = harness(FakeShareStore(StoredShare("alex", share), offset = start))
        h.source.deliver(FakeSharingRepository.sessionFor(share, timer30).copy(active = false, endReason = EndReason.TIMER, endedAtMillis = start + 1_800_000))
        runCurrent()
        assertEquals(EndReason.TIMER, (h.state as ShareState.Ended).end.reason)
        assertEquals(0, h.uploader.running)
    }

    @Test
    fun `another account's kept share is forgotten`() = runTest {
        val share = FakeSharingRepository.shareFor(timer30, startedAt = start)
        val store = FakeShareStore(StoredShare("someone-else", share))
        val h = harness(store)
        assertEquals(ShareState.Idle, h.state)
        assertNull(store.stored)
    }

    @Test
    fun `after a reboot only the session doc ends a kept share, until the server's time is known`() = runTest {
        val share = FakeSharingRepository.shareFor(timer30, startedAt = start)
        // No offset: the phone's clock (two hours fast) would say this share ended long ago.
        val h = harness(FakeShareStore(StoredShare("alex", share)))
        h.deliverCreated()
        advanceTimeBy(10_000)
        runCurrent()
        assertTrue(h.state is ShareState.Live)
    }

    @Test
    fun `a service Android refused at restart starts when the app comes to the front`() = runTest {
        val share = FakeSharingRepository.shareFor(timer30, startedAt = start)
        val store = FakeShareStore(StoredShare("alex", share), offset = start)
        val h = Harness(this, store, refuseService = true)
        runCurrent()
        assertTrue(h.state is ShareState.Live)
        assertFalse(h.service.isRunning)
        h.service.refuse = false
        h.repo.onAppForeground()
        assertTrue(h.service.isRunning)
    }

    @Test
    fun `a kept share whose location permission was taken away doesn't start the service`() = runTest {
        val share = FakeSharingRepository.shareFor(timer30, startedAt = start)
        val store = FakeShareStore(StoredShare("alex", share), offset = start)
        val h = Harness(this, store, permission = false)
        runCurrent()
        assertEquals(0, h.service.starts)
        h.permission = true
        h.repo.onAppForeground()
        assertEquals(1, h.service.starts)
    }

    // ---- The session doc's listener --------------------------------------------

    @Test
    fun `a session that's gone (discarded elsewhere, account deleted) is forgotten`() = runTest {
        val h = harness()
        h.create()
        h.source.remote.value = RemoteSession.Missing
        runCurrent()
        assertEquals(ShareState.Idle, h.state)
        assertNull(h.store.stored)
        assertEquals(0, h.uploader.running)
    }

    @Test
    fun `a failed listener starts again with backoff, and the local end keeps time meanwhile`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        h.source.remote.value = RemoteSession.Failed(SharingFailure.Network)
        runCurrent()
        assertEquals(1, h.source.observeCalls)
        h.source.remote.value = null
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(2, h.source.observeCalls)
        advanceTimeBy(30 * 60_000L)
        runCurrent()
        assertEquals(EndReason.TIMER, (h.state as ShareState.Ended).end.reason)
    }

    @Test
    fun `signing out stops and forgets the share`() = runTest {
        val h = harness()
        h.create()
        h.signOut()
        runCurrent()
        assertEquals(ShareState.Idle, h.state)
        assertEquals(0, h.uploader.running)
        assertFalse(h.service.isRunning)
        assertNull(h.store.stored)
    }

    // ---- Changes while live --------------------------------------------------------

    @Test
    fun `a precision change waits for the next ping as precision_next`() = runTest {
        val h = harness()
        h.create()
        assertEquals(UpdateShareResult.Failed(SharingFailure.NotSharing), h.repo.setPrecision(Precision.APPROXIMATE))
        h.deliverCreated()
        assertEquals(UpdateShareResult.Updated, h.repo.setPrecision(Precision.APPROXIMATE))
        assertEquals(listOf<Precision?>(Precision.APPROXIMATE), h.source.precisionNexts)
        // Already precise, with nothing pending: nothing to write.
        h.source.precisionNexts.clear()
        assertEquals(UpdateShareResult.Updated, h.repo.setPrecision(Precision.PRECISE))
        assertTrue(h.source.precisionNexts.isEmpty())
        // Changing back before the next ping clears the pending change.
        val live = (h.state as ShareState.Live).session!!
        h.source.deliver(live.copy(precisionNext = Precision.APPROXIMATE))
        runCurrent()
        h.repo.setPrecision(Precision.PRECISE)
        assertEquals(listOf<Precision?>(null), h.source.precisionNexts)
    }

    @Test
    fun `the timer sheet writes the new stop rule, capped at the limit`() = runTest {
        val h = harness()
        val atLimit = timer30.copy(stop = StopChoice.AtLimit)
        h.create(atLimit)
        h.deliverCreated(atLimit)
        advanceTimeBy(20 * 60_000L)
        h.repo.changeStop(StopChoice.After(StopMinutes.MINUTES_15))
        assertEquals(StopWrite(StopRule.MINUTES, StopMinutes.MINUTES_15, start + 35 * 60_000L), h.source.stopWrites.last())
        advanceTimeBy(30 * 60_000L)
        assertEquals(UpdateShareResult.Updated, h.repo.changeStop(StopChoice.After(StopMinutes.MINUTES_15)))
        assertEquals(StopWrite(StopRule.MINUTES, StopMinutes.MINUTES_15, start + 3_600_000L), h.source.stopWrites.last())
        h.repo.changeStop(StopChoice.AtLimit)
        assertEquals(StopWrite(StopRule.LIMIT, null, start + 3_600_000L), h.source.stopWrites.last())
        assertEquals(UpdateShareResult.Failed(SharingFailure.Invalid), h.repo.changeStop(StopChoice.WhenCallEnds))
    }

    @Test
    fun `the timer can change before the first snapshot arrives`() = runTest {
        val h = harness()
        h.create()
        assertEquals(UpdateShareResult.Updated, h.repo.changeStop(StopChoice.After(StopMinutes.MINUTES_60)))
        // In 1 hour from a minute in would pass the limit: capped at expires_at exactly.
        assertEquals(StopWrite(StopRule.MINUTES, StopMinutes.MINUTES_60, start + 3_600_000L), h.source.stopWrites.last())
        h.repo.stop()
        assertEquals(UpdateShareResult.Failed(SharingFailure.NotSharing), h.repo.changeStop(StopChoice.AtLimit))
    }

    @Test
    fun `a failed change says why`() = runTest {
        val h = harness()
        h.create()
        h.deliverCreated()
        h.source.updateFailure = SharingDataException(SharingFailure.Network)
        assertEquals(UpdateShareResult.Failed(SharingFailure.Network), h.repo.changeStop(StopChoice.AtLimit))
    }

    // ---- The notification's Stop sharing ---------------------------------------------

    @Test
    fun `Stop sharing from the notification asks the live screen to confirm, only while live`() = runTest {
        val h = harness()
        h.repo.requestStopConfirmation()
        assertFalse(h.repo.stopConfirmationRequested.value)
        h.create()
        h.repo.requestStopConfirmation()
        assertTrue(h.repo.stopConfirmationRequested.value)
        h.repo.consumeStopConfirmation()
        assertFalse(h.repo.stopConfirmationRequested.value)
    }

    @Test
    fun `the live state carries the uploader's status`() = runTest {
        val h = harness()
        h.create()
        h.uploader.status.value = UploadStatus.Initial.copy(signal = GpsSignal.NoSignal, offline = true)
        runCurrent()
        assertEquals(GpsSignal.NoSignal, (h.state as ShareState.Live).upload.signal)
        assertTrue((h.state as ShareState.Live).upload.offline)
    }
}
