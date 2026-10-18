package live.trackme.app.ui

import java.time.LocalTime
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.domain.Greeting
import live.trackme.app.fakes.FakeClock
import live.trackme.app.fakes.FakeProfileRepository
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UploadStatus
import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import live.trackme.app.fakes.MainDispatcherRule
import live.trackme.app.ui.home.HomeViewModel
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4

/** Robolectric for android.icu (the name check). */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class HomeViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    @Test
    fun greetsByNameWithTheirMascot() = runTest(main.dispatcher.scheduler) {
        val profiles = FakeProfileRepository(ProfileState.Loading)
        val vm = HomeViewModel(profiles, FakeClock(testScheduler, LocalTime.of(9, 0)), FakeSharingRepository())
        backgroundScope.launch { vm.state.collect {} }
        runCurrent()
        assertFalse(vm.state.value.loaded)
        assertNull(vm.state.value.name)
        assertEquals(Greeting.Morning, vm.state.value.greeting)

        profiles.profile.value = ProfileState.Ready(Profile(name = "Alex", mascotId = MascotId.NEKO, mascotColor = MascotColor.DUSK))
        runCurrent()
        val s = vm.state.value
        assertTrue(s.loaded)
        assertEquals("Alex", s.name)
        assertEquals(MascotId.NEKO, s.mascotId)
        assertEquals(MascotColor.DUSK, s.mascotColor)
    }

    @Test
    fun theGreetingMovesOnWhileHomeIsOpen() = runTest(main.dispatcher.scheduler) {
        val vm = HomeViewModel(FakeProfileRepository(), FakeClock(testScheduler, LocalTime.of(11, 59)), FakeSharingRepository())
        backgroundScope.launch { vm.state.collect {} }
        runCurrent()
        assertEquals(Greeting.Morning, vm.state.value.greeting)
        advanceTimeBy(60_001)
        runCurrent()
        assertEquals(Greeting.Afternoon, vm.state.value.greeting)
    }

    @Test
    fun noProfileStillGreets() = runTest(main.dispatcher.scheduler) {
        val vm = HomeViewModel(FakeProfileRepository(ProfileState.Missing), FakeClock(testScheduler), FakeSharingRepository())
        backgroundScope.launch { vm.state.collect {} }
        runCurrent()
        assertTrue(vm.state.value.loaded)
        assertNull(vm.state.value.name)
        assertEquals(MascotId.FOX, vm.state.value.mascotId)
    }

    @Test
    fun aLiveShareShowsOnHome() = runTest(main.dispatcher.scheduler) {
        val sharing = FakeSharingRepository()
        val vm = HomeViewModel(FakeProfileRepository(), FakeClock(testScheduler), sharing)
        backgroundScope.launch { vm.state.collect {} }
        runCurrent()
        assertFalse(vm.state.value.live)

        val request = ShareRequest(StopChoice.AtLimit, Precision.PRECISE, false, viewerName = "  Mom  ")
        val share = FakeSharingRepository.shareFor(request)
        sharing.emit(ShareState.Live(share, null, UploadStatus.Initial))
        runCurrent()
        assertTrue(vm.state.value.live)
        assertEquals("Mom", vm.state.value.liveWith)

        sharing.emit(ShareState.Live(share.copy(viewerName = null), null, UploadStatus.Initial))
        runCurrent()
        assertNull(vm.state.value.liveWith)

        sharing.endWith(EndReason.STOPPED)
        runCurrent()
        assertFalse("ended is not live", vm.state.value.live)
    }
}
