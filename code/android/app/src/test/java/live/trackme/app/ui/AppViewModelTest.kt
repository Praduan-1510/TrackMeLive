package live.trackme.app.ui

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.settings.Appearance
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.fakes.FakeAuthRepository
import live.trackme.app.fakes.FakeLocalPreferences
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
        val vm = AppViewModel(FakeLocalPreferences(SetupStage.Done, Appearance.Dark), FakeAuthRepository(signedInAs = "u1"))
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
        val vm = AppViewModel(prefs, FakeAuthRepository())
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
        val vm = AppViewModel(prefs, auth)
        advanceUntilIdle()
        assertEquals(RootScreen.Main, vm.state.value.root)
        auth.signOut()
        advanceUntilIdle()
        assertEquals(SetupStage.SignUp, prefs.setupStage.value)
        assertEquals(RootScreen.SignUp, vm.state.value.root)
    }
}
