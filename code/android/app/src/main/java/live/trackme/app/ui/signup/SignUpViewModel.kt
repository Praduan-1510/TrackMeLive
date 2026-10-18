package live.trackme.app.ui.signup

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import live.trackme.app.Names
import live.trackme.app.di.AppContainer
import live.trackme.app.data.auth.AuthRepository
import live.trackme.app.data.auth.SendCodeResult
import live.trackme.app.data.auth.SignInEndedNotice
import live.trackme.app.data.auth.SendFailure
import live.trackme.app.data.auth.VerifyCodeResult
import live.trackme.app.data.auth.VerifyFailure
import live.trackme.app.data.profile.FetchProfileResult
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.data.settings.LocalPreferences
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.domain.Clock
import live.trackme.app.domain.Country
import live.trackme.app.domain.PhoneCheck
import live.trackme.app.domain.PhoneInput
import live.trackme.app.domain.PhoneNumbers
import live.trackme.app.domain.ResendCountdown
import live.trackme.schema.TmlSchemaConstants

/**
 * Sign-up (FSD §4 Sign up): a name and a mobile number, confirmed with a 6-digit code. A new account
 * gets its profile through saveProfile and goes on to the mascot picker; someone signing back in on a
 * new phone gets their profile restored as it was and goes straight to Home. Either way the view model
 * finishes by moving the stored setup stage on, and the app's root follows.
 *
 * The three text values are Compose state written synchronously from each keystroke, as Compose
 * recommends for text fields (a round trip through a Flow can drop keystrokes). Everything else is in
 * [state]. Fields are checked when they lose focus after an edit, and all of them on Send code.
 */
class SignUpViewModel(
    private val auth: AuthRepository,
    private val profiles: ProfileRepository,
    private val preferences: LocalPreferences,
    private val phoneNumbers: PhoneNumbers,
    private val clock: Clock,
    defaultRegion: String,
    private val saved: SavedStateHandle,
    /** When the server ends the sign-in, sign-up says "Your sign-in has ended. Sign in again." once. */
    private val signInEndedNotice: SignInEndedNotice = NoNotice,
) : ViewModel() {

    var name by mutableStateOf(saved.get<String>(KEY_NAME).orEmpty())
        private set

    var phone by mutableStateOf(PhoneInput(saved.get<String>(KEY_REGION) ?: defaultRegion, saved.get<String>(KEY_DIGITS).orEmpty()))
        private set

    var code by mutableStateOf("")
        private set

    private val _state = MutableStateFlow(SignUpUiState(country = phoneNumbers.country(phone.region)))
    val state: StateFlow<SignUpUiState> = _state.asStateFlow()

    private val effects = Channel<SignUpEffect>(Channel.BUFFERED)
    val effectFlow: Flow<SignUpEffect> = effects.receiveAsFlow()

    /** Every country, by name, for the picker. Built on first use. */
    val countries: List<Country> by lazy { phoneNumbers.countries() }

    /** The number field's drawing: [digits] formatted as you type for [region]. */
    fun formatPhone(region: String, digits: String): String = phoneNumbers.formatAsYouType(region, digits)

    /** The picker's search. */
    fun filterCountries(countries: List<Country>, query: String): List<Country> = phoneNumbers.filter(countries, query)

    private var nameEdited = false
    private var phoneEdited = false
    private var e164: String? = null
    private var countdown: Job? = null
    private var work: Job? = null

    init {
        // Signed in already: a sign-up that was interrupted after the number was confirmed (the app was
        // closed before the profile was saved). Restore the profile if it made it to the server;
        // otherwise only the name is left to ask for, with no new text.
        if (auth.currentUserId() != null) {
            _state.update { it.copy(numberConfirmed = true) }
            work = viewModelScope.launch {
                if (profiles.fetch() is FetchProfileResult.Found) preferences.setSetupStage(SetupStage.Done)
            }
        }

        // The sign-in ended (now, or just before sign-up opened): say so once.
        viewModelScope.launch {
            signInEndedNotice.pending.collect { pending ->
                if (pending) {
                    signInEndedNotice.consume()
                    _state.update { it.copy(signInEnded = true) }
                }
            }
        }

        // The phone read the text by itself: fill in the code and check it.
        viewModelScope.launch {
            auth.retrievedCodes.collect { retrieved ->
                val digits = retrieved.filter(Char::isDigit).take(CODE_LENGTH)
                if (_state.value.step == SignUpStep.Code && digits.length == CODE_LENGTH && work?.isActive != true) {
                    code = digits
                    verify()
                }
            }
        }
    }

    // ---------- Details ----------

    fun onNameChange(value: String) {
        val limited = Names.limitInput(value)
        if (limited == name) return
        name = limited
        nameEdited = true
        saved[KEY_NAME] = limited
        // Once an error shows, it clears as soon as the name is fixed.
        if (_state.value.nameProblem != null && Names.isValid(limited)) _state.update { it.copy(nameProblem = null) }
    }

    fun onNameFocusChange(focused: Boolean) {
        if (focused || !nameEdited) return
        tidyName()
        _state.update { it.copy(nameProblem = Names.problem(name)) }
    }

    fun onPhoneChange(value: String) {
        val next = phoneNumbers.input(phone, value)
        if (next == phone) return
        updatePhone(next)
        phoneEdited = true
        if (_state.value.numberError != null && phoneNumbers.check(next) is PhoneCheck.Valid) {
            _state.update { it.copy(numberError = null) }
        }
    }

    fun onPhoneFocusChange(focused: Boolean) {
        if (focused || !phoneEdited) return
        _state.update { it.copy(numberError = numberErrorOrNull()) }
    }

    fun onCountrySelected(region: String) {
        if (region == phone.region) return
        // A half-typed international number belongs to the old choice.
        updatePhone(PhoneInput(region, phone.digits.takeUnless { it.startsWith("+") }.orEmpty()))
        if (_state.value.numberError != null) _state.update { it.copy(numberError = numberErrorOrNull()) }
    }

    /** Send code (or Try again after it failed). */
    fun sendCode() {
        val s = _state.value
        if (s.sending || s.finishing) return
        if (s.finishFailed) {
            finishInBackground()
            return
        }
        tidyName()
        val nameProblem = Names.problem(name)
        if (s.numberConfirmed) {
            _state.update { it.copy(nameProblem = nameProblem) }
            if (nameProblem != null) {
                effects.trySend(SignUpEffect.Focus(SignUpEffect.Field.Name))
            } else if (work?.isActive != true) {
                _state.update { it.copy(finishing = true) }
                work = viewModelScope.launch { finish() }
            }
            return
        }
        val check = phoneNumbers.check(phone)
        _state.update {
            it.copy(
                nameProblem = nameProblem,
                numberError = if (check is PhoneCheck.Valid) null else numberError(),
                sendProblem = null,
                signInEnded = false,
            )
        }
        when {
            nameProblem != null -> effects.trySend(SignUpEffect.Focus(SignUpEffect.Field.Name))
            check !is PhoneCheck.Valid -> effects.trySend(SignUpEffect.Focus(SignUpEffect.Field.Number))
            else -> {
                _state.update { it.copy(sending = true) }
                work = viewModelScope.launch {
                    val result = auth.sendCode(check.e164)
                    _state.update { it.copy(sending = false) }
                    when (result) {
                        SendCodeResult.CodeSent -> {
                            e164 = check.e164
                            showCodeStep(check.international)
                        }
                        is SendCodeResult.SignedIn -> {
                            _state.update { it.copy(finishing = true) }
                            finish()
                        }
                        is SendCodeResult.Failed -> onSendFailed(result.reason)
                    }
                }
            }
        }
    }

    private fun onSendFailed(reason: SendFailure) {
        when (reason) {
            SendFailure.InvalidNumber -> {
                _state.update { it.copy(numberError = numberError()) }
                effects.trySend(SignUpEffect.Focus(SignUpEffect.Field.Number))
            }
            SendFailure.TooManyRequests -> _state.update { it.copy(sendProblem = Problem.TooManyRequests) }
            SendFailure.Network, SendFailure.Other -> _state.update { it.copy(sendProblem = Problem.Network) }
        }
    }

    private fun showCodeStep(sentTo: String) {
        code = ""
        _state.update {
            it.copy(step = SignUpStep.Code, sentTo = sentTo, codeStatus = CodeStatus.Idle, codeExpired = false, finishFailed = false)
        }
        startCountdown()
        effects.trySend(SignUpEffect.Focus(SignUpEffect.Field.Code))
    }

    // ---------- Code ----------

    fun onCodeChange(value: String) {
        val digits = value.filter { it in '0'..'9' }.take(CODE_LENGTH)
        if (digits == code || _state.value.codeStatus == CodeStatus.Checking) return
        code = digits
        // Typing again clears the last message; Send a new code stays offered after an expired code.
        _state.update { if (it.codeStatus == CodeStatus.Idle) it else it.copy(codeStatus = CodeStatus.Idle) }
        if (digits.length == CODE_LENGTH) verify()
    }

    /** Checks the code; called on its sixth digit. */
    fun verify() {
        if (code.length != CODE_LENGTH || work?.isActive == true) return
        _state.update { it.copy(codeStatus = CodeStatus.Checking) }
        work = viewModelScope.launch {
            when (val result = auth.verifyCode(code)) {
                is VerifyCodeResult.SignedIn -> finish()
                VerifyCodeResult.Wrong -> {
                    code = ""
                    _state.update { it.copy(codeStatus = CodeStatus.Wrong) }
                    effects.trySend(SignUpEffect.Focus(SignUpEffect.Field.Code))
                }
                VerifyCodeResult.Expired -> {
                    code = ""
                    _state.update { it.copy(codeStatus = CodeStatus.Expired, codeExpired = true) }
                    effects.trySend(SignUpEffect.Focus(SignUpEffect.Field.Code))
                }
                is VerifyCodeResult.Failed -> {
                    val problem = result.reason.toProblem()
                    // Too many tries spends this code: the way on is a new code, once the wait is over.
                    // After a dropped connection the code stays, for Try again.
                    if (problem == Problem.TooManyRequests) code = ""
                    _state.update { it.copy(codeStatus = CodeStatus.CheckFailed(problem)) }
                }
            }
        }
    }

    /** Send a new code, once the countdown has run out or the code expired. */
    fun resendCode() {
        val number = e164 ?: return
        val s = _state.value
        if (!s.canResend || s.resending || work?.isActive == true) return
        _state.update { it.copy(resending = true) }
        work = viewModelScope.launch {
            val result = auth.sendCode(number, resend = true)
            _state.update { it.copy(resending = false) }
            when (result) {
                SendCodeResult.CodeSent -> {
                    code = ""
                    _state.update { it.copy(codeStatus = CodeStatus.NewCodeSent, codeExpired = false) }
                    startCountdown()
                    effects.trySend(SignUpEffect.Focus(SignUpEffect.Field.Code))
                }
                is SendCodeResult.SignedIn -> finish()
                is SendCodeResult.Failed -> {
                    val problem = if (result.reason == SendFailure.TooManyRequests) Problem.TooManyRequests else Problem.Network
                    _state.update { it.copy(codeStatus = CodeStatus.SendFailed(problem)) }
                }
            }
        }
    }

    /** Try again under the code: whatever failed last, once more. */
    fun tryAgain() {
        val s = _state.value
        when {
            s.finishFailed -> finishInBackground()
            s.codeStatus is CodeStatus.CheckFailed && code.length == CODE_LENGTH -> verify()
            s.codeStatus is CodeStatus.SendFailed -> resendCode()
        }
    }

    private fun startCountdown() {
        countdown?.cancel()
        val sentAt = clock.elapsedMillis()
        countdown = viewModelScope.launch {
            while (true) {
                val now = clock.elapsedMillis()
                val left = ResendCountdown.secondsLeft(sentAt, now)
                _state.update { it.copy(resendSecondsLeft = left) }
                if (left == 0) break
                delay(ResendCountdown.millisToNextTick(sentAt, now))
            }
        }
    }

    // ---------- Finishing ----------

    private fun finishInBackground() {
        if (work?.isActive == true) return
        work = viewModelScope.launch { finish() }
    }

    /**
     * Signed in: restore the profile if this number already has one, or create it. Then move the setup
     * stage on, which takes the app to Home (restored) or the mascot picker (new).
     */
    private suspend fun finish() {
        _state.update {
            it.copy(finishFailed = false, codeStatus = if (it.step == SignUpStep.Code) CodeStatus.Checking else it.codeStatus)
        }
        val fetched = profiles.fetch()
        val created = (fetched as? FetchProfileResult.NotFound)?.let { profiles.create(name) }
        val failure = (fetched as? FetchProfileResult.Failed)?.reason ?: (created as? SaveProfileResult.Failed)?.reason
        when {
            fetched is FetchProfileResult.Found -> preferences.setSetupStage(SetupStage.Done)
            created is SaveProfileResult.Saved -> preferences.setSetupStage(SetupStage.Mascot)
            failure == ProfileFailure.SignInEnded || failure == ProfileFailure.NotSignedIn -> startOverSignedOut(failure)
            else -> _state.update { it.copy(finishFailed = true, finishing = false, codeStatus = CodeStatus.Idle) }
        }
    }

    /**
     * The server no longer accepts this sign-in: back to the details, signed out, to sign in again.
     * (A saveProfile that answered unauthenticated has already signed out through AccountSession.)
     */
    private suspend fun startOverSignedOut(failure: ProfileFailure) {
        countdown?.cancel()
        code = ""
        if (auth.currentUserId() != null) auth.signOut()
        _state.update {
            it.copy(
                step = SignUpStep.Details,
                codeStatus = CodeStatus.Idle,
                finishFailed = false,
                finishing = false,
                numberConfirmed = false,
                codeExpired = false,
                // AccountSession's notice adds "Your sign-in has ended" for an unauthenticated answer.
                signInEnded = it.signInEnded || failure == ProfileFailure.SignInEnded,
            )
        }
    }

    // ---------- Back ----------

    /** Back: from the code to the details (signing out if the number was already confirmed). False on the details step. */
    fun back(): Boolean {
        val s = _state.value
        if (s.step == SignUpStep.Details && s.numberConfirmed) {
            // Leave the interrupted sign-up: sign out and start again with a number.
            work?.cancel()
            viewModelScope.launch { auth.signOut() }
            _state.update { it.copy(numberConfirmed = false, finishing = false, finishFailed = false) }
            return true
        }
        if (s.step == SignUpStep.Details) return false
        work?.cancel()
        countdown?.cancel()
        code = ""
        if (auth.currentUserId() != null) viewModelScope.launch { auth.signOut() }
        _state.update { it.copy(step = SignUpStep.Details, codeStatus = CodeStatus.Idle, finishFailed = false, codeExpired = false) }
        return true
    }

    // ---------- Helpers ----------

    private fun tidyName() {
        val tidy = Names.tidy(name)
        if (tidy != name) {
            name = tidy
            saved[KEY_NAME] = tidy
        }
    }

    private fun updatePhone(next: PhoneInput) {
        val regionChanged = next.region != phone.region
        phone = next
        saved[KEY_REGION] = next.region
        saved[KEY_DIGITS] = next.digits
        if (regionChanged) _state.update { it.copy(country = phoneNumbers.country(next.region)) }
    }

    private fun numberError() = NumberError(phoneNumbers.exampleNumber(phone.region))

    private fun numberErrorOrNull(): NumberError? = if (phoneNumbers.check(phone) is PhoneCheck.Valid) null else numberError()

    private fun VerifyFailure.toProblem() = if (this == VerifyFailure.TooManyRequests) Problem.TooManyRequests else Problem.Network

    private object NoNotice : SignInEndedNotice {
        override val pending: StateFlow<Boolean> = MutableStateFlow(false)
        override fun consume() = Unit
    }

    companion object {
        const val CODE_LENGTH = TmlSchemaConstants.OTP_LENGTH
        private const val KEY_NAME = "signup.name"
        private const val KEY_REGION = "signup.region"
        private const val KEY_DIGITS = "signup.digits"

        fun factory(container: AppContainer) = viewModelFactory {
            initializer {
                SignUpViewModel(
                    auth = container.auth,
                    profiles = container.profiles,
                    preferences = container.preferences,
                    phoneNumbers = container.phoneNumbers,
                    clock = container.clock,
                    defaultRegion = container.defaultRegion(),
                    saved = createSavedStateHandle(),
                    signInEndedNotice = container.session,
                )
            }
        }
    }
}
