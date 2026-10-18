package live.trackme.app.ui

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.settings.Appearance
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.fakes.FakeAuthRepository
import live.trackme.app.fakes.FakeLocalPreferences
import live.trackme.app.fakes.FakeSharingRepository
import kotlinx.coroutines.test.TestScope
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UploadStatus
import live.trackme.app.ui.navigation.SharingScreen
import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import org.junit.Assert.assertNull
import live.trackme.app.fakes.MainDispatcherRule
import live.trackme.app.ui.navigation.AppViewModel
import live.trackme.app.ui.navigation.RootScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    @Test
    fun rootFollowsTheStoredStageAndTheSignIn() {
        assertEquals(RootScreen.Onboarding, AppViewModel.rootFor(SetupStage.Onboarding, null))
        assertEquals(RootScreen.Onboarding, AppViewModel.rootFor(SetupStage.Onboarding, "u1"))
        assertEquals(RootScreen.SignUp, AppViewModel.rootFor(SetupStage.SignUp, null))
        assertEquals(RootScreen.SignUp, AppViewModel.rootFor(SetupStage.SignUp, "u1"))
        assertEquals(RootScreen.MascotSetup, AppViewModel.rootFor(SetupStage.Mascot, "u1"))
        assertEquals(RootScreen.Main, AppViewModel.rootFor(SetupStage.Done, "u1"))
        // Signed out after setup: sign up (or back in) again.
        assertEquals(RootScreen.SignUp, AppViewModel.rootFor(SetupStage.Done, null))
        assertEquals(RootScreen.SignUp, AppViewModel.rootFor(SetupStage.Mascot, null))
    }

    @Test
    fun notReadyUntilTheStoredValuesLoad() = runTest(main.dispatcher.scheduler) {
        val vm = AppViewModel(FakeLocalPreferences(SetupStage.Done, Appearance.Dark), FakeAuthRepository(signedInAs = "u1"), FakeSharingRepository())
        assertFalse(vm.state.value.ready)
        advanceUntilIdle()
        val s = vm.state.value
        assertTrue(s.ready)
        assertEquals(RootScreen.Main, s.root)
        assertEquals(Appearance.Dark, s.appearance)
    }

    @Test
    fun onboardingThenBackFromSignUpReopensTheLastPage() = runTest(main.dispatcher.scheduler) {
        val prefs = FakeLocalPreferences(SetupStage.Onboarding)
        val vm = AppViewModel(prefs, FakeAuthRepository(), FakeSharingRepository())
        advanceUntilIdle()
        assertEquals(0, vm.state.value.onboardingPage)
        vm.finishOnboarding()
        advanceUntilIdle()
        assertEquals(SetupStage.SignUp, prefs.setupStage.value)
        assertEquals(RootScreen.SignUp, vm.state.value.root)
        vm.reopenOnboarding()
        advanceUntilIdle()
        assertEquals(RootScreen.Onboarding, vm.state.value.root)
        assertEquals(AppViewModel.LAST_ONBOARDING_PAGE, vm.state.value.onboardingPage)
    }

    @Test
    fun signedOutAfterSetupResetsTheStage() = runTest(main.dispatcher.scheduler) {
        val prefs = FakeLocalPreferences(SetupStage.Done)
        val auth = FakeAuthRepository(signedInAs = "u1")
        val vm = AppViewModel(prefs, auth, FakeSharingRepository())
        advanceUntilIdle()
        assertEquals(RootScreen.Main, vm.state.value.root)
        auth.signOut()
        advanceUntilIdle()
        assertEquals(SetupStage.SignUp, prefs.setupStage.value)
        assertEquals(RootScreen.SignUp, vm.state.value.root)
    }

    // ---------- The sharing screens over Home ----------

    private fun liveState(sharing: FakeSharingRepository): ShareState.Live {
        val request = ShareRequest(StopChoice.After(StopMinutes.MINUTES_30), Precision.PRECISE, false, viewerName = "Mom")
        val share = FakeSharingRepository.shareFor(request)
        return ShareState.Live(share, FakeSharingRepository.sessionFor(share, request), UploadStatus.Initial)
    }

    private fun TestScope.signedIn(sharing: FakeSharingRepository): AppViewModel {
        val vm = AppViewModel(FakeLocalPreferences(SetupStage.Done), FakeAuthRepository(signedInAs = "u1"), sharing)
        advanceUntilIdle()
        return vm
    }

    @Test
    fun shareOpensTheShareScreenThenTheLiveMapOnceTheLinkWentOut() = runTest(main.dispatcher.scheduler) {
        val sharing = FakeSharingRepository()
        val vm = signedIn(sharing)
        assertEquals(listOf<Any>(RootScreen.Main), vm.state.value.backStack)

        vm.openShare()
        advanceUntilIdle()
        assertEquals(listOf(RootScreen.Main, SharingScreen.Share()), vm.state.value.backStack)

        // The session exists while its share sheet is open: the share screen stays.
        sharing.emit(liveState(sharing))
        advanceUntilIdle()
        assertEquals(SharingScreen.Share(), vm.state.value.sharing)

        vm.shared()
        advanceUntilIdle()
        assertEquals(listOf(RootScreen.Main, SharingScreen.Live), vm.state.value.backStack)
        assertTrue(vm.state.value.askAlerts)

        // Back to Home: the share keeps going, and Home's card or Share opens the map again.
        vm.back()
        advanceUntilIdle()
        assertEquals(listOf<Any>(RootScreen.Main), vm.state.value.backStack)
        vm.openShare()
        advanceUntilIdle()
        assertEquals(SharingScreen.Live, vm.state.value.sharing)
        assertFalse("only right after the link went out", vm.state.value.askAlerts)
    }

    @Test
    fun backFromTheShareScreenIsHome() = runTest(main.dispatcher.scheduler) {
        val vm = signedIn(FakeSharingRepository())
        vm.openShare()
        vm.back()
        advanceUntilIdle()
        assertNull(vm.state.value.sharing)
    }

    @Test
    fun theLiveMapShowsOnlyWhileTheShareIsLive() = runTest(main.dispatcher.scheduler) {
        val sharing = FakeSharingRepository()
        val vm = signedIn(sharing)
        // The notification's Open, before the share has loaded: Home until it's live, then the map.
        vm.openLive()
        advanceUntilIdle()
        assertNull(vm.state.value.sharing)
        sharing.emit(liveState(sharing))
        advanceUntilIdle()
        assertEquals(SharingScreen.Live, vm.state.value.sharing)
    }

    @Test
    fun anEndedShareMovesOnToTheEndedScreenWhereverThePersonIs() = runTest(main.dispatcher.scheduler) {
        val sharing = FakeSharingRepository()
        sharing.emit(liveState(sharing))
        val vm = signedIn(sharing)
        assertNull("Home", vm.state.value.sharing)
        sharing.endWith(EndReason.TIMER)
        advanceUntilIdle()
        assertEquals(listOf(RootScreen.Main, SharingScreen.Ended), vm.state.value.backStack)

        vm.done()
        advanceUntilIdle()
        assertEquals(1, sharing.dismissals)
        assertEquals(ShareState.Idle, sharing.state.value)
        assertNull(vm.state.value.sharing)
    }

    @Test
    fun backOnTheEndedScreenIsDone() = runTest(main.dispatcher.scheduler) {
        val sharing = FakeSharingRepository()
        sharing.emit(liveState(sharing))
        val vm = signedIn(sharing)
        vm.openLive()
        sharing.endWith(EndReason.STOPPED)
        advanceUntilIdle()
        assertEquals(SharingScreen.Ended, vm.state.value.sharing)
        vm.back()
        advanceUntilIdle()
        assertEquals(1, sharing.dismissals)
        assertNull(vm.state.value.sharing)
        // The old request to show the map doesn't come back with the next share.
        sharing.emit(liveState(sharing))
        advanceUntilIdle()
        assertNull(vm.state.value.sharing)
    }

    @Test
    fun shareAgainAtTheLimitStartsANewShareAtOnce() = runTest(main.dispatcher.scheduler) {
        val sharing = FakeSharingRepository()
        sharing.emit(liveState(sharing))
        val vm = signedIn(sharing)
        sharing.endWith(EndReason.LIMIT)
        advanceUntilIdle()
        vm.shareAgain()
        advanceUntilIdle()
        assertEquals(1, sharing.dismissals)
        assertEquals(SharingScreen.Share(autoShare = true), vm.state.value.sharing)
    }

    @Test
    fun theNotificationsStopOpensTheLiveMap() = runTest(main.dispatcher.scheduler) {
        val sharing = FakeSharingRepository()
        sharing.emit(liveState(sharing))
        val vm = signedIn(sharing)
        sharing.requestStopConfirmation()
        advanceUntilIdle()
        assertEquals(SharingScreen.Live, vm.state.value.sharing)
    }

    @Test
    fun sharingScreensShowOnlyOverHome() = runTest(main.dispatcher.scheduler) {
        val sharing = FakeSharingRepository()
        sharing.emit(liveState(sharing))
        sharing.endWith(EndReason.LIMIT)
        val vm = AppViewModel(FakeLocalPreferences(SetupStage.SignUp), FakeAuthRepository(), sharing)
        advanceUntilIdle()
        assertEquals(listOf<Any>(RootScreen.SignUp), vm.state.value.backStack)
    }
}
