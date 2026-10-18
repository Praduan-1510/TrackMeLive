package live.trackme.app.ui.signup

import android.text.BidiFormatter
import android.text.TextDirectionHeuristics
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.platform.LocalContext
import live.trackme.app.di.appContainer
import live.trackme.app.NameProblem
import live.trackme.app.R
import live.trackme.app.domain.Country
import live.trackme.app.domain.ResendCountdown
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.ButtonVariant
import live.trackme.app.ui.components.PrimaryButton
import live.trackme.app.ui.components.TmlButton
import live.trackme.app.ui.components.tabular
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Sign-up wired to [SignUpViewModel]. Back from the first step returns to onboarding. */
@Composable
fun SignUpRoute(
    onBackToOnboarding: () -> Unit,
    vm: SignUpViewModel = viewModel(factory = SignUpViewModel.factory(LocalContext.current.appContainer)),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val name = remember { FocusRequester() }
    val number = remember { FocusRequester() }
    val code = remember { FocusRequester() }
    LaunchedEffect(vm) {
        vm.effectFlow.collect { effect ->
            if (effect is SignUpEffect.Focus) {
                val target = when (effect.field) {
                    SignUpEffect.Field.Name -> name
                    SignUpEffect.Field.Number -> number
                    SignUpEffect.Field.Code -> code
                }
                // A field that isn't on screen (mid-transition) can't take focus; the code field
                // focuses itself when its step appears.
                try {
                    target.requestFocus()
                } catch (_: IllegalStateException) {
                }
            }
        }
    }
    val back = { if (!vm.back()) onBackToOnboarding() }
    BackHandler(onBack = back)

    SignUpScreen(
        state = state,
        name = vm.name,
        phoneDigits = vm.phone.digits,
        code = vm.code,
        countries = { vm.countries },
        formatPhone = vm::formatPhone,
        filterCountries = vm::filterCountries,
        actions = SignUpActions(
            onBack = back,
            onNameChange = vm::onNameChange,
            onNameFocusChange = vm::onNameFocusChange,
            onPhoneChange = vm::onPhoneChange,
            onPhoneFocusChange = vm::onPhoneFocusChange,
            onCountrySelected = vm::onCountrySelected,
            onSendCode = vm::sendCode,
            onCodeChange = vm::onCodeChange,
            onVerify = vm::verify,
            onResend = vm::resendCode,
            onTryAgain = vm::tryAgain,
        ),
        focus = SignUpFocus(name, number, code),
    )
}

/** What the sign-up screens can ask for. */
class SignUpActions(
    val onBack: () -> Unit,
    val onNameChange: (String) -> Unit,
    val onNameFocusChange: (Boolean) -> Unit,
    val onPhoneChange: (String) -> Unit,
    val onPhoneFocusChange: (Boolean) -> Unit,
    val onCountrySelected: (String) -> Unit,
    val onSendCode: () -> Unit,
    val onCodeChange: (String) -> Unit,
    val onVerify: () -> Unit,
    val onResend: () -> Unit,
    val onTryAgain: () -> Unit,
)

class SignUpFocus(val name: FocusRequester, val number: FocusRequester, val code: FocusRequester)

/**
 * Create your account, then Enter the code (prototype › viewSignup). Stateless: the view model holds
 * the state and every decision; this only lays it out.
 */
@Composable
fun SignUpScreen(
    state: SignUpUiState,
    name: String,
    phoneDigits: String,
    code: String,
    countries: () -> List<Country>,
    formatPhone: (String, String) -> String,
    filterCountries: (List<Country>, String) -> List<Country>,
    actions: SignUpActions,
    focus: SignUpFocus,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxSize()
            .background(TmlTheme.colors.ground)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding(),
    ) {
        BackBar(onBack = actions.onBack)
        AnimatedContent(
            targetState = state.step,
            transitionSpec = {
                // Forward slides in from the end; back from the start (Material shared axis X).
                val forward = targetState == SignUpStep.Code
                (slideInHorizontally(tween(300)) { w -> if (forward) w / 8 else -w / 8 } + fadeIn(tween(300))) togetherWith
                    (slideOutHorizontally(tween(200)) { w -> if (forward) -w / 8 else w / 8 } + fadeOut(tween(200)))
            },
            modifier = Modifier.weight(1f),
            label = "signupStep",
        ) { step ->
            when (step) {
                SignUpStep.Details -> DetailsStep(state, name, phoneDigits, countries, formatPhone, filterCountries, actions, focus)
                SignUpStep.Code -> CodeStep(state, code, actions, focus)
            }
        }
    }
}

@Composable
private fun BackBar(onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(64.dp).padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(
            onClick = onBack,
            colors = IconButtonDefaults.iconButtonColors(contentColor = TmlTheme.colors.ink),
            modifier = Modifier.size(48.dp),
        ) {
            Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.signup_back))
        }
    }
}

// ---------- Name and number ----------

@Composable
private fun DetailsStep(
    state: SignUpUiState,
    name: String,
    phoneDigits: String,
    countries: () -> List<Country>,
    formatPhone: (String, String) -> String,
    filterCountries: (List<Country>, String) -> List<Country>,
    actions: SignUpActions,
    focus: SignUpFocus,
) {
    val c = TmlTheme.colors
    var picking by rememberSaveable { mutableStateOf(false) }
    val region = state.country.region
    val transformation = remember(region, formatPhone) { PhoneNumberTransformation { formatPhone(region, it) } }

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = TmlSpacing.Space4),
        ) {
            Column(Modifier.widthIn(max = 560.dp).fillMaxWidth().align(Alignment.CenterHorizontally)) {
                Title(stringResource(R.string.signup_title))
                Lede(stringResource(if (state.numberConfirmed) R.string.signup_lede_confirmed else R.string.signup_lede))
                if (state.signInEnded) {
                    FieldMessage(stringResource(R.string.signup_sign_in_ended), isError = true, modifier = Modifier.padding(top = TmlSpacing.Space4))
                }

                TmlTextField(
                    value = name,
                    onValueChange = actions.onNameChange,
                    label = stringResource(R.string.signup_name),
                    helper = stringResource(R.string.signup_name_help),
                    error = when (state.nameProblem) {
                        NameProblem.Empty -> stringResource(R.string.signup_name_error)
                        NameProblem.TooLong -> stringResource(R.string.signup_name_too_long)
                        NameProblem.NoLetters -> stringResource(R.string.signup_name_no_letters)
                        null -> null
                    },
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Words,
                        autoCorrectEnabled = false,
                        keyboardType = KeyboardType.Text,
                        imeAction = if (state.numberConfirmed) ImeAction.Done else ImeAction.Next,
                    ),
                    keyboardActions = KeyboardActions(
                        onNext = { focus.number.requestFocus() },
                        onDone = { actions.onSendCode() },
                    ),
                    onFocusChange = actions.onNameFocusChange,
                    modifier = Modifier
                        .padding(top = 28.dp)
                        .focusRequester(focus.name)
                        .semantics { contentType = ContentType.PersonFirstName },
                )

                if (!state.numberConfirmed) TmlTextField(
                    value = phoneDigits,
                    onValueChange = actions.onPhoneChange,
                    label = stringResource(R.string.signup_number),
                    helper = stringResource(R.string.signup_number_help),
                    error = state.numberError?.let { e ->
                        if (e.example != null) stringResource(R.string.signup_number_error, e.example) else stringResource(R.string.signup_number_error_plain)
                    },
                    leading = { CountryButton(state.country, onClick = { picking = true }) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Send, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onSend = { actions.onSendCode() }),
                    visualTransformation = transformation,
                    textStyle = AppType.body.tabular(),
                    onFocusChange = actions.onPhoneFocusChange,
                    modifier = Modifier
                        .padding(top = TmlSpacing.Space4)
                        .focusRequester(focus.number)
                        .semantics { contentType = ContentType.PhoneNumber },
                )

                val problem = when {
                    state.finishFailed -> stringResource(R.string.signup_finish_failed)
                    state.sendProblem == Problem.TooManyRequests -> stringResource(R.string.signup_too_many)
                    state.sendProblem == Problem.Network -> stringResource(R.string.signup_send_failed)
                    else -> null
                }
                if (problem != null) {
                    FieldMessage(problem, isError = true, modifier = Modifier.padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = TmlSpacing.Space4))
                }
                Spacer(Modifier.height(TmlSpacing.Space6))
            }
        }

        Column(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .align(Alignment.CenterHorizontally)
                .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, bottom = TmlSpacing.Space6),
        ) {
            val retry = state.sendProblem != null || state.finishFailed
            val label = when {
                retry -> R.string.signup_try_again
                state.numberConfirmed -> R.string.signup_continue
                else -> R.string.signup_send
            }
            PrimaryButton(text = stringResource(label), onClick = actions.onSendCode, loading = state.sending || state.finishing)
            if (!state.numberConfirmed) {
                Text(
                    text = stringResource(R.string.signup_fine),
                    style = HelperStyle,
                    color = c.inkSecondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                )
            }
        }
    }

    if (picking) {
        CountryPickerSheet(
            countries = countries(),
            selectedRegion = region,
            filter = filterCountries,
            onSelect = {
                actions.onCountrySelected(it)
                picking = false
            },
            onDismiss = { picking = false },
        )
    }
}

/** "US +1 ▾" inside the number field: opens the country sheet. TalkBack reads the country's name. */
@Composable
private fun CountryButton(country: Country, onClick: () -> Unit) {
    val c = TmlTheme.colors
    val description = stringResource(R.string.signup_country_description, country.name, country.callingCode)
    val action = stringResource(R.string.signup_country_action)
    Row(
        Modifier
            .heightIn(min = 48.dp)
            .clickable(onClickLabel = action, role = Role.Button, onClick = onClick)
            // One TalkBack stop: "Country: United States, +1, button, double-tap to change country".
            .clearAndSetSemantics { contentDescription = description }
            .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.signup_country_value, country.region, country.callingCode),
            style = AppType.body.tabular().copy(fontWeight = FontWeight.W600),
            color = c.ink,
        )
        Icon(painterResource(R.drawable.ic_arrow_drop_down), contentDescription = null, tint = c.inkSecondary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(TmlSpacing.Space2))
        Box(Modifier.width(1.dp).height(24.dp).background(c.separator))
    }
}

// ---------- The code ----------

@Composable
private fun CodeStep(state: SignUpUiState, code: String, actions: SignUpActions, focus: SignUpFocus) {
    val checking = state.codeStatus == CodeStatus.Checking
    val error = when (val s = state.codeStatus) {
        CodeStatus.Wrong -> stringResource(R.string.code_wrong)
        CodeStatus.Expired -> stringResource(R.string.code_expired)
        is CodeStatus.CheckFailed -> stringResource(if (s.problem == Problem.TooManyRequests) R.string.code_too_many_tries else R.string.code_check_failed)
        is CodeStatus.SendFailed -> stringResource(if (s.problem == Problem.TooManyRequests) R.string.signup_too_many else R.string.signup_send_failed)
        else -> if (state.finishFailed) stringResource(R.string.signup_finish_failed) else null
    }
    val note = when (state.codeStatus) {
        CodeStatus.Checking -> stringResource(R.string.code_checking)
        CodeStatus.NewCodeSent -> stringResource(R.string.code_new_sent)
        else -> null
    }
    // Arriving on this step puts the cursor in the code, with the number keyboard up.
    LaunchedEffect(Unit) { focus.code.requestFocus() }

    val canTryAgain = state.finishFailed || state.codeStatus == CodeStatus.CheckFailed(Problem.Network) ||
        (state.codeStatus is CodeStatus.SendFailed && state.canResend)

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = TmlSpacing.Space4),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
            Title(stringResource(R.string.code_title))
            Lede(stringResource(R.string.code_lede, isolate(state.sentTo)))
        }
        CodeField(
            code = code,
            onCodeChange = actions.onCodeChange,
            length = SignUpViewModel.CODE_LENGTH,
            isError = state.codeStatus == CodeStatus.Wrong || state.codeStatus == CodeStatus.Expired,
            readOnly = checking,
            onDone = actions.onVerify,
            errorMessage = error,
            modifier = Modifier.padding(top = 28.dp).focusRequester(focus.code),
        )

        // One polite live region for the line under the code: TalkBack hears each new message once.
        Box(Modifier.padding(top = TmlSpacing.Space4).semantics { liveRegion = LiveRegionMode.Polite }) {
            when {
                error != null -> FieldMessage(error, isError = true)
                note != null -> Text(note, style = AppType.supporting, color = TmlTheme.colors.inkSecondary, textAlign = TextAlign.Center)
            }
        }

        when {
            canTryAgain -> TmlButton(
                text = stringResource(R.string.signup_try_again),
                onClick = actions.onTryAgain,
                variant = ButtonVariant.Tonal,
                loading = state.resending || checking,
                modifier = Modifier.padding(top = TmlSpacing.Space2),
            )
            state.canResend -> TmlButton(
                text = stringResource(R.string.code_resend),
                onClick = actions.onResend,
                variant = ButtonVariant.Plain,
                enabled = !checking,
                loading = state.resending,
                modifier = Modifier.padding(top = TmlSpacing.Space2),
            )
            else -> Text(
                // Not a live region: the countdown would be read out every second.
                text = stringResource(R.string.code_resend_in, ResendCountdown.label(state.resendSecondsLeft)),
                style = AppType.supporting.tabular(),
                color = TmlTheme.colors.inkSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = TmlSpacing.Space2).heightIn(min = 48.dp).wrapContentHeight(Alignment.CenterVertically),
            )
        }
        Spacer(Modifier.height(TmlSpacing.Space6))
    }
}

@Composable
private fun Title(text: String) {
    Text(
        text = text,
        style = AppType.appBar,
        color = TmlTheme.colors.ink,
        modifier = Modifier.padding(top = 4.dp).semantics { heading() },
    )
}

@Composable
private fun Lede(text: String) {
    Text(text = text, style = AppType.body, color = TmlTheme.colors.inkSecondary, modifier = Modifier.padding(top = TmlSpacing.Space2))
}

/** Keeps a phone number in one left-to-right run, even inside right-to-left text. */
private fun isolate(number: String): String = BidiFormatter.getInstance().unicodeWrap(number, TextDirectionHeuristics.LTR)
