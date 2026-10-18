package live.trackme.app.ui.live

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.location.PermissionStatus
import live.trackme.app.data.sharing.GpsSignal
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.SharedPoint
import live.trackme.app.data.sharing.SharingFailure
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UpdateShareResult
import live.trackme.app.data.sharing.UploadStatus
import live.trackme.app.fakes.FakeLocationPermissions
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.app.fakes.MainDispatcherRule
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.share.Audience
import live.trackme.app.ui.share.ShareSheetContent
import live.trackme.schema.EndReason
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.Precision
import live.trackme.schema.SharerSnapshot
import live.trackme.schema.StopMinutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class LiveViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private val sharing = FakeSharingRepository()
    private val permissions = FakeLocationPermissions(FakeLocationPermissions.AllGranted)
    private val start = FakeSharingRepository.START_MILLIS

    private fun live(
        stop: StopChoice = StopChoice.After(StopMinutes.MINUTES_30),
        viewer: String? = "Mom",
        precision: Precision = Precision.PRECISE,
        upload: UploadStatus = UploadStatus.Initial.copy(precision = precision, intervalSeconds = 3.5),
        edit: (live.trackme.app.data.sharing.SessionView) -> live.trackme.app.data.sharing.SessionView = { it },
    ): ShareState.Live {
        val request = ShareRequest(stop = stop, precision = precision, shareBackAllowed = false, viewerName = viewer)
        val share = FakeSharingRepository.shareFor(request)
        val session = FakeSharingRepository.sessionFor(share, request)
            .copy(sharer = SharerSnapshot("Alex", MascotId.ROBOT, MascotColor.LAGOON, null))
        return ShareState.Live(share, edit(session), upload)
    }

    private fun TestScope.vm(askAlerts: Boolean = false): Pair<LiveViewModel, MutableList<LiveEvent>> {
        val vm = LiveViewModel(sharing, permissions, askAlerts) { "Alex" }
        val events = mutableListOf<LiveEvent>()
        backgroundScope.launch { vm.state.collect {} }
        backgroundScope.launch { vm.events.toList(events) }
        runCurrent()
        return vm to events
    }

    @Test
    fun presentsTheShareFromTheSessionAndThePings() = runTest(main.dispatcher.scheduler) {
        val point = SharedPoint(37.8, -122.4, 8.0, start + 3_000, Precision.PRECISE)
        sharing.emit(live(upload = UploadStatus(3.5, Precision.PRECISE, point, GpsSignal.Ok, offline = false)))
        sharing.now = start + 5 * 60_000
        val (vm, _) = vm()
        val s = vm.state.value
        assertTrue(s.live)
        assertEquals(Audience("Mom"), s.audience)
        assertEquals(MascotLook(MascotId.ROBOT, MascotColor.LAGOON), s.look)
        assertEquals(start, s.startedAtMillis)
        assertEquals(start + 60 * 60_000, s.expiresAtMillis)
        assertEquals(start + 30 * 60_000, s.endsAtMillis)
        assertEquals(start + 5 * 60_000, s.nowMillis)
        assertEquals(StopChoice.After(StopMinutes.MINUTES_30), s.stop)
        assertFalse(s.followsCall)
        assertFalse(s.limitSoon)
        assertNull(s.openedAtMillis)
        assertEquals(SharerSignal.Live, s.signal)
        assertEquals(3.5, s.intervalSeconds, 0.0)
        assertEquals(Precision.PRECISE, s.precision)
        assertFalse(s.precisionPending)
        assertEquals(point, s.point)
        assertEquals(ShareSheetContent(FakeSharingRepository.shareFor(ShareRequest(StopChoice.AtLimit, Precision.PRECISE, false)).linkUrl, "Alex"), s.link)
    }

    @Test
    fun timerChoicesShrinkAsTheLimitNears() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live())
        val (vm, _) = vm()
        assertEquals(
            listOf(StopChoice.After(StopMinutes.MINUTES_15), StopChoice.After(StopMinutes.MINUTES_30), StopChoice.AtLimit),
            vm.state.value.stopOptions,
        )
        sharing.now = start + 40 * 60_000
        advanceTimeBy(LiveViewModel.TICK_MILLIS + 1)
        runCurrent()
        assertEquals(listOf(StopChoice.After(StopMinutes.MINUTES_15), StopChoice.AtLimit), vm.state.value.stopOptions)
        sharing.now = start + 50 * 60_000
        advanceTimeBy(LiveViewModel.TICK_MILLIS + 1)
        runCurrent()
        assertEquals(listOf(StopChoice.AtLimit), vm.state.value.stopOptions)
    }

    @Test
    fun theOneHourWarningShowsFiveMinutesBeforeTheLimit() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live(stop = StopChoice.AtLimit))
        sharing.now = start + 54 * 60_000
        val (vm, _) = vm()
        assertEquals(StopChoice.AtLimit, vm.state.value.stop)
        assertFalse(vm.state.value.limitSoon)
        sharing.now = start + 55 * 60_000
        advanceTimeBy(LiveViewModel.TICK_MILLIS + 1)
        runCurrent()
        assertTrue(vm.state.value.limitSoon)
    }

    @Test
    fun aTimerThatReachesTheLimitReadsAsTheLimit() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live(stop = StopChoice.After(StopMinutes.MINUTES_60)))
        val (vm, _) = vm()
        assertEquals(StopChoice.AtLimit, vm.state.value.stop)
    }

    @Test
    fun theSharersSignalFollowsThePings() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live(upload = UploadStatus.Initial.copy(signal = GpsSignal.NoSignal)))
        val (vm, _) = vm()
        assertEquals(SharerSignal.NoGps, vm.state.value.signal)
        sharing.emit(live(upload = UploadStatus.Initial.copy(signal = GpsSignal.NoSignal, offline = true)))
        runCurrent()
        assertEquals("no connection wins", SharerSignal.Offline, vm.state.value.signal)
        sharing.emit(live(upload = UploadStatus.Initial.copy(signal = GpsSignal.Searching)))
        runCurrent()
        assertEquals(SharerSignal.Live, vm.state.value.signal)
    }

    @Test
    fun theOpenedTimeComesFromTheSession() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live { it.copy(firstViewedAtMillis = start + 120_000) })
        val (vm, _) = vm()
        assertEquals(start + 120_000, vm.state.value.openedAtMillis)
    }

    @Test
    fun beforeTheFirstSnapshotTheShareStillShows() = runTest(main.dispatcher.scheduler) {
        val share = live().share
        sharing.emit(ShareState.Live(share, session = null, upload = UploadStatus.Initial))
        val (vm, _) = vm()
        val s = vm.state.value
        assertTrue(s.live)
        assertEquals(share.expiresAtMillis, s.endsAtMillis)
        assertEquals(StopChoice.AtLimit, s.stop)
        assertEquals("Alex", s.link?.sharerName)
    }

    @Test
    fun notLiveShowsNothing() = runTest(main.dispatcher.scheduler) {
        val (vm, _) = vm()
        assertFalse(vm.state.value.live)
    }

    @Test
    fun aPrecisionChangeWaitsForTheNextPing() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live())
        val (vm, _) = vm()
        vm.onPrecisionChange(Precision.APPROXIMATE)
        runCurrent()
        assertEquals(listOf(Precision.APPROXIMATE), sharing.precisionChanges)
        assertEquals(Precision.APPROXIMATE, vm.state.value.precisionShown)
        assertTrue(vm.state.value.precisionPending)

        // The session shows it as pending, then the next ping applies it.
        sharing.emit(live { it.copy(precisionNext = Precision.APPROXIMATE) })
        runCurrent()
        assertTrue(vm.state.value.precisionPending)
        sharing.emit(live(precision = Precision.APPROXIMATE))
        runCurrent()
        assertEquals(Precision.APPROXIMATE, vm.state.value.precision)
        assertFalse(vm.state.value.precisionPending)

        // The same choice again does nothing.
        vm.onPrecisionChange(Precision.APPROXIMATE)
        runCurrent()
        assertEquals(1, sharing.precisionChanges.size)
    }

    @Test
    fun aPrecisionChangeThatFailsGoesBackAndSaysSo() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live())
        sharing.nextUpdate = UpdateShareResult.Failed(SharingFailure.Network)
        val (vm, events) = vm()
        vm.onPrecisionChange(Precision.APPROXIMATE)
        runCurrent()
        assertEquals(Precision.PRECISE, vm.state.value.precisionShown)
        assertEquals(listOf(LiveEvent.UpdateFailed), events)
    }

    @Test
    fun preciseMidShareAsksTheSystemFirst() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(preciseLocation = false)
        sharing.emit(live(precision = Precision.APPROXIMATE))
        val (vm, events) = vm()
        vm.onPrecisionChange(Precision.PRECISE)
        runCurrent()
        assertEquals(listOf(LiveEvent.RequestPrecise), events)
        assertTrue(sharing.precisionChanges.isEmpty())

        vm.onPreciseResult(mapOf(FakeLocationPermissions.FINE to false, FakeLocationPermissions.COARSE to true))
        runCurrent()
        assertTrue("kept approximate", sharing.precisionChanges.isEmpty())

        vm.onPreciseResult(mapOf(FakeLocationPermissions.FINE to true, FakeLocationPermissions.COARSE to true))
        runCurrent()
        assertEquals(listOf(Precision.PRECISE), sharing.precisionChanges)
    }

    @Test
    fun theTimerSheetChangesTheStopRule() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live())
        val (vm, events) = vm()
        vm.onStopChange(StopChoice.AtLimit)
        runCurrent()
        assertEquals(listOf(StopChoice.AtLimit), sharing.stopChanges)
        assertTrue(events.isEmpty())

        sharing.nextUpdate = UpdateShareResult.Failed(SharingFailure.Network)
        vm.onStopChange(StopChoice.After(StopMinutes.MINUTES_15))
        runCurrent()
        assertEquals(listOf(LiveEvent.UpdateFailed), events)
    }

    @Test
    fun stopAsksFirstAndStopsOnceConfirmed() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live())
        val (vm, _) = vm()
        vm.onStopConfirmed()
        runCurrent()
        assertEquals("nothing stops without the question", 0, sharing.stops)

        vm.onStopTapped()
        runCurrent()
        assertTrue(vm.state.value.confirmingStop)
        vm.onStopCancelled()
        runCurrent()
        assertFalse(vm.state.value.confirmingStop)
        assertEquals(0, sharing.stops)

        vm.onStopTapped()
        vm.onStopConfirmed()
        vm.onStopConfirmed() // a double tap
        runCurrent()
        assertEquals(1, sharing.stops)
        assertTrue(sharing.state.value is ShareState.Ended)
        assertEquals(EndReason.STOPPED, (sharing.state.value as ShareState.Ended).end.reason)
    }

    @Test
    fun theNotificationsStopAsksHereOnce() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live())
        val (vm, _) = vm()
        sharing.requestStopConfirmation()
        runCurrent()
        assertTrue(vm.state.value.confirmingStop)
        assertFalse("consumed", sharing.stopConfirmationRequested.value)
        assertEquals(0, sharing.stops)
    }

    @Test
    fun alertsAreAskedOnceAfterTheFirstLinkWhenTheSystemWouldAsk() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(notifications = PermissionStatus.NotAsked)
        sharing.emit(live())
        val (vm, events) = vm(askAlerts = true)
        assertTrue(vm.state.value.askAlerts)
        vm.onAlertsYes()
        runCurrent()
        assertFalse(vm.state.value.askAlerts)
        assertEquals(listOf(LiveEvent.RequestNotifications(FakeLocationPermissions.NOTIFICATIONS)), events)
        vm.onNotificationResult(true)
        assertEquals(listOf(true), permissions.notificationResults)
    }

    @Test
    fun notNowLeavesAlertsOff() = runTest(main.dispatcher.scheduler) {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(notifications = PermissionStatus.NotAsked)
        sharing.emit(live())
        val (vm, events) = vm(askAlerts = true)
        vm.onAlertsNotNow()
        runCurrent()
        assertFalse(vm.state.value.askAlerts)
        assertTrue(events.isEmpty())
    }

    @Test
    fun alertsAreNotAskedWhenAlreadyAnswered() = runTest(main.dispatcher.scheduler) {
        sharing.emit(live())
        listOf(PermissionStatus.Granted, PermissionStatus.Denied, PermissionStatus.DeniedForever).forEach { status ->
            permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(notifications = status)
            assertFalse(status.name, vm(askAlerts = true).first.state.value.askAlerts)
        }
        permissions.mutableState.value = FakeLocationPermissions.AllGranted.copy(notifications = PermissionStatus.NotAsked)
        assertFalse("only right after a link went out", vm(askAlerts = false).first.state.value.askAlerts)
    }
}
