package live.trackme.app.ui

import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.NameProblem
import kotlinx.coroutines.flow.MutableStateFlow
import live.trackme.app.data.auth.SendCodeResult
import live.trackme.app.data.auth.SignInEndedNotice
import live.trackme.app.data.auth.SendFailure
import live.trackme.app.data.auth.VerifyCodeResult
import live.trackme.app.data.auth.VerifyFailure
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.domain.PhoneNumbers
import live.trackme.app.fakes.FakeAuthRepository
import live.trackme.app.fakes.FakeClock
import live.trackme.app.fakes.FakeLocalPreferences
import live.trackme.app.fakes.FakeProfileRepository
import live.trackme.app.fakes.MainDispatcherRule
import live.trackme.app.ui.signup.CodeStatus
import live.trackme.app.ui.signup.NumberError
import live.trackme.app.ui.signup.Problem
import live.trackme.app.ui.signup.SignUpEffect
import live.trackme.app.ui.signup.SignUpStep
import live.trackme.app.ui.signup.SignUpViewModel
import live.trackme.schema.MascotId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Sign-up's decisions, against fakes. Robolectric for android.icu (grapheme counting). */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class SignUpViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private val auth = FakeAuthRepository()
    private val profiles = FakeProfileRepository()
    private val prefs = FakeLocalPreferences(SetupStage.SignUp)

    private fun TestScope.viewModel(saved: SavedStateHandle = SavedStateHandle()) = SignUpViewModel(
        auth = auth,
        profiles = profiles,
        preferences = prefs,
        phoneNumbers = PhoneNumbers(),
        clock = FakeClock(testScheduler),
        defaultRegion = "US",
        saved = saved,
    )

    private fun SignUpViewModel.fillIn(name: String = "Alex", number: String = "4155550142") {
        onNameChange(name)
        onPhoneChange(number)
    }

    @Test
    fun nameIsCheckedWhenTheFieldIsLeftAfterAnEdit() = runTest(main.dispatcher.scheduler) {
        val vm = viewModel()
        vm.onNameFocusChange(true)
        vm.onNameFocusChange(false)
        assertNull("untouched: no error yet", vm.state.value.nameProblem)

        vm.onNameChange("   ")
        vm.onNameFocusChange(false)
        assertEquals(NameProblem.Empty, vm.state.value.nameProblem)

        vm.onNameChange("Al")
        assertNull("fixed: the error clears while typing", vm.state.value.nameProblem)
    }

    @Test
    fun nameIsTidiedAndTypingStopsAtTwentyFour() = runTest(main.dispatcher.scheduler) {
        val vm = viewModel()
        vm.onNameChange("  Mary   Jane ")
        vm.onNameFocusChange(false)
        assertEquals("Mary Jane", vm.name)

        vm.onNameChange("a".repeat(24))
        vm.onNameChange("a".repeat(25))
        assertEquals("a".repeat(24), vm.name)
    }

    @Test
    fun numberIsCheckedOnBlurWithTheCountrysExample() = runTest(main.dispatcher.scheduler) {
        val vm = viewModel()
        vm.onPhoneChange("41555")
        vm.onPhoneFocusChange(false)
        assertEquals(NumberError("(201) 555-0123"), vm.state.value.numberError)

        vm.onPhoneChange("4155550142")
        assertNull(vm.state.value.numberError)
    }

    @Test
    fun aPastedInternationalNumberMovesTheCountry() = runTest(main.dispatcher.scheduler) {
        val vm = viewModel()
        vm.onPhoneChange("+44 7700 900123")
        assertEquals("GB", vm.state.value.country.region)
        assertEquals("7700900123", vm.phone.digits)
        vm.onCountrySelected("IN")
        assertEquals("IN", vm.state.value.country.region)
        assertEquals(91, vm.state.value.country.callingCode)
    }

    @Test
    fun sendCodeFocusesTheFirstInvalidField() = runTest(main.dispatcher.scheduler) {
        val vm = viewModel()
        val effects = mutableListOf<SignUpEffect>()
        backgroundScope.launch { vm.effectFlow.toList(effects) }
        vm.onPhoneChange("123")
        vm.sendCode()
        runCurrent()
        assertEquals(NameProblem.Empty, vm.state.value.nameProblem)
        assertTrue(vm.state.value.numberError != null)
        assertEquals(SignUpEffect.Focus(SignUpEffect.Field.Name), effects.last())

        vm.onNameChange("Alex")
        vm.sendCode()
        runCurrent()
        assertEquals(SignUpEffect.Focus(SignUpEffect.Field.Number), effects.last())
        assertTrue("nothing was sent", auth.sent.isEmpty())
    }

    @Test
    fun sendCodeSendsE164AndOpensTheCodeStepWithACountdown() = runTest(main.dispatcher.scheduler) {
        val vm = viewModel()
        val effects = mutableListOf<SignUpEffect>()
        backgroundScope.launch { vm.effectFlow.toList(effects) }
        vm.fillIn()
        val gate = CompletableDeferred<Unit>()
        auth.sendGate = gate
        vm.sendCode()
        runCurrent()
        assertTrue("the button shows progress", vm.state.value.sending)
        gate.complete(Unit)
        runCurrent()

        assertEquals(listOf("+14155550142" to false), auth.sent)
        val s = vm.state.value
        assertEquals(SignUpStep.Code, s.step)
        assertEquals("+1 415-555-0142", s.sentTo)
        assertEquals(30, s.resendSecondsLeft)
        assertFalse(s.canResend)
        assertEquals(SignUpEffect.Focus(SignUpEffect.Field.Code), effects.last())

        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(29, vm.state.value.resendSecondsLeft)
        advanceTimeBy(29_000)
        runCurrent()
        assertEquals(0, vm.state.value.resendSecondsLeft)
        assertTrue(vm.state.value.canResend)
    }

    @Test
    fun sendFailuresSayWhatHappened() = runTest(main.dispatcher.scheduler) {
        val vm = viewModel()
        vm.fillIn()
        auth.nextSend = SendCodeResult.Failed(SendFailure.Network)
        vm.sendCode()
        advanceUntilIdle()
        assertEquals(Problem.Network, vm.state.value.sendProblem)
        assertEquals(SignUpStep.Details, vm.state.value.step)

        auth.nextSend = SendCodeResult.Failed(SendFailure.TooManyRequests)
        vm.sendCode()
        advanceUntilIdle()
        assertEquals(Problem.TooManyRequests, vm.state.value.sendProblem)

        // Firebase refusing the number shows under the number field.
        auth.nextSend = SendCodeResult.Failed(SendFailure.InvalidNumber)
        vm.sendCode()
        advanceUntilIdle()
        assertEquals(NumberError("(201) 555-0123"), vm.state.value.numberError)

        // Try again works.
        vm.sendCode()
        advanceUntilIdle()
        assertEquals(SignUpStep.Code, vm.state.value.step)
        assertNull(vm.state.value.sendProblem)
    }

    private suspend fun TestScope.onCodeStep(): SignUpViewModel {
        val vm = viewModel()
        vm.fillIn()
        vm.sendCode()
        runCurrent()
        return vm
    }

    @Test
    fun aNewAccountGetsItsProfileThenTheMascotPicker() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        vm.onCodeChange("12345")
        assertTrue(auth.verified.isEmpty())
        vm.onCodeChange("123456") // the sixth digit checks it
        assertEquals(CodeStatus.Checking, vm.state.value.codeStatus)
        advanceUntilIdle()
        assertEquals(listOf("Alex"), profiles.created)
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)
    }

    @Test
    fun aReturningPersonIsRestoredNotOverwritten() = runTest(main.dispatcher.scheduler) {
        profiles.onServer = Profile(name = "Alexandra", mascotId = MascotId.NEKO)
        val vm = onCodeStep()
        vm.onCodeChange("123456")
        advanceUntilIdle()
        assertTrue("the typed name never replaces the stored one", profiles.created.isEmpty())
        assertEquals(SetupStage.Done, prefs.setupStage.value)
    }

    @Test
    fun aWrongCodeClearsAndKeepsFocus() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        val effects = mutableListOf<SignUpEffect>()
        backgroundScope.launch { vm.effectFlow.toList(effects) }
        vm.onCodeChange("000000")
        advanceUntilIdle()
        assertEquals(CodeStatus.Wrong, vm.state.value.codeStatus)
        assertEquals("", vm.code)
        assertEquals(SignUpEffect.Focus(SignUpEffect.Field.Code), effects.last())
        vm.onCodeChange("1")
        assertEquals("typing again clears the message", CodeStatus.Idle, vm.state.value.codeStatus)
        assertEquals(SetupStage.SignUp, prefs.setupStage.value)
    }

    @Test
    fun anExpiredCodeOffersANewOneAtOnce() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        auth.nextVerify = VerifyCodeResult.Expired
        vm.onCodeChange("123456")
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(CodeStatus.Expired, vm.state.value.codeStatus)
        assertTrue("Send a new code shows before the countdown ends", vm.state.value.canResend)

        vm.resendCode()
        runCurrent()
        assertEquals(listOf("+14155550142" to false, "+14155550142" to true), auth.sent)
        assertEquals(CodeStatus.NewCodeSent, vm.state.value.codeStatus)
        assertFalse(vm.state.value.canResend)
        assertEquals(30, vm.state.value.resendSecondsLeft)
    }

    @Test
    fun resendWaitsForTheCountdown() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        vm.resendCode()
        runCurrent()
        assertEquals(1, auth.sent.size)
        advanceTimeBy(30_000)
        runCurrent()
        auth.nextSend = SendCodeResult.Failed(SendFailure.Network)
        vm.resendCode()
        runCurrent()
        assertEquals(CodeStatus.SendFailed(Problem.Network), vm.state.value.codeStatus)
        vm.tryAgain()
        runCurrent()
        assertEquals(CodeStatus.NewCodeSent, vm.state.value.codeStatus)
    }

    @Test
    fun aCheckThatCouldNotRunCanBeRetried() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        auth.nextVerify = VerifyCodeResult.Failed(VerifyFailure.Network)
        vm.onCodeChange("123456")
        runCurrent()
        assertEquals(CodeStatus.CheckFailed(Problem.Network), vm.state.value.codeStatus)
        assertEquals("the code stays for Try again", "123456", vm.code)
        vm.tryAgain()
        advanceUntilIdle()
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)
    }

    @Test
    fun aProfileThatCouldNotBeSavedCanBeRetried() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        profiles.failSave = ProfileFailure.Network
        vm.onCodeChange("123456")
        advanceUntilIdle()
        assertTrue(vm.state.value.finishFailed)
        assertEquals(SetupStage.SignUp, prefs.setupStage.value)
        vm.tryAgain()
        advanceUntilIdle()
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)
        assertEquals(listOf("Alex", "Alex"), profiles.created)
    }

    @Test
    fun theCodeTheTextBroughtFillsInAndIsChecked() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        auth.retrieved.emit("123456")
        advanceUntilIdle()
        assertEquals(listOf("123456"), auth.verified)
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)
    }

    @Test
    fun instantVerificationSkipsTheCode() = runTest(main.dispatcher.scheduler) {
        val vm = viewModel()
        vm.fillIn()
        auth.nextSend = SendCodeResult.SignedIn("user-1")
        vm.sendCode()
        advanceUntilIdle()
        assertEquals(SignUpStep.Details, vm.state.value.step)
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)
    }

    @Test
    fun backFromTheCodeReturnsToTheDetails() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        assertTrue(vm.back())
        assertEquals(SignUpStep.Details, vm.state.value.step)
        assertEquals("Alex", vm.name)
        assertFalse("the details step hands back to onboarding", vm.back())
    }

    @Test
    fun backAfterTheNumberWasConfirmedSignsOut() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        profiles.failSave = ProfileFailure.Network
        vm.onCodeChange("123456")
        advanceUntilIdle()
        assertEquals("user-1", auth.userId.value)
        vm.back()
        advanceUntilIdle()
        assertNull(auth.userId.value)
    }

    @Test
    fun anInterruptedSignUpWhoseProfileMadeItIsRestored() = runTest(main.dispatcher.scheduler) {
        val signedIn = FakeAuthRepository(signedInAs = "user-1")
        profiles.onServer = Profile(name = "Alex")
        SignUpViewModel(signedIn, profiles, prefs, PhoneNumbers(), FakeClock(testScheduler), "US", SavedStateHandle())
        advanceUntilIdle()
        assertEquals(SetupStage.Done, prefs.setupStage.value)
        assertEquals(0, signedIn.signOuts)
    }

    @Test
    fun anInterruptedSignUpAsksOnlyForTheName() = runTest(main.dispatcher.scheduler) {
        val signedIn = FakeAuthRepository(signedInAs = "user-1")
        val vm = SignUpViewModel(signedIn, profiles, prefs, PhoneNumbers(), FakeClock(testScheduler), "US", SavedStateHandle())
        advanceUntilIdle()
        assertTrue(vm.state.value.numberConfirmed)
        vm.sendCode()
        assertEquals(NameProblem.Empty, vm.state.value.nameProblem)
        vm.onNameChange("Alex")
        vm.sendCode()
        advanceUntilIdle()
        assertTrue("no new text", signedIn.sent.isEmpty())
        assertEquals(listOf("Alex"), profiles.created)
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)
    }

    @Test
    fun backFromAnInterruptedSignUpSignsOutAndStartsAgain() = runTest(main.dispatcher.scheduler) {
        val signedIn = FakeAuthRepository(signedInAs = "user-1")
        val vm = SignUpViewModel(signedIn, profiles, prefs, PhoneNumbers(), FakeClock(testScheduler), "US", SavedStateHandle())
        advanceUntilIdle()
        assertTrue(vm.back())
        advanceUntilIdle()
        assertFalse(vm.state.value.numberConfirmed)
        assertNull(signedIn.userId.value)
    }

    @Test
    fun tooManyTriesSpendsTheCode() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        auth.nextVerify = VerifyCodeResult.Failed(VerifyFailure.TooManyRequests)
        vm.onCodeChange("123456")
        runCurrent()
        assertEquals(CodeStatus.CheckFailed(Problem.TooManyRequests), vm.state.value.codeStatus)
        assertEquals("", vm.code)
    }

    private class Notice(pendingAtStart: Boolean) : SignInEndedNotice {
        override val pending = MutableStateFlow(pendingAtStart)
        override fun consume() {
            pending.value = false
        }
    }

    @Test
    fun anEndedSignInIsExplainedOnceOnSignUp() = runTest(main.dispatcher.scheduler) {
        val notice = Notice(pendingAtStart = true)
        val vm = SignUpViewModel(auth, profiles, prefs, PhoneNumbers(), FakeClock(testScheduler), "US", SavedStateHandle(), notice)
        runCurrent()
        assertTrue(vm.state.value.signInEnded)
        assertFalse("shown once", notice.pending.value)
        vm.fillIn()
        vm.sendCode()
        assertFalse("gone once they send a code", vm.state.value.signInEnded)
    }

    @Test
    fun anEndedSignInDuringSignUpStartsOverSignedOut() = runTest(main.dispatcher.scheduler) {
        val vm = onCodeStep()
        profiles.failSave = ProfileFailure.SignInEnded
        vm.onCodeChange("123456")
        advanceUntilIdle()
        val s = vm.state.value
        assertEquals(SignUpStep.Details, s.step)
        assertTrue(s.signInEnded)
        assertFalse(s.finishFailed)
        assertNull(auth.userId.value)
        assertEquals(SetupStage.SignUp, prefs.setupStage.value)
    }

    @Test
    fun typedDetailsSurviveProcessDeath() = runTest(main.dispatcher.scheduler) {
        val saved = SavedStateHandle()
        viewModel(saved).fillIn(name = "Alex", number = "+447700900123")
        val restored = viewModel(saved)
        assertEquals("Alex", restored.name)
        assertEquals("GB", restored.state.value.country.region)
        assertEquals("7700900123", restored.phone.digits)
    }
}
