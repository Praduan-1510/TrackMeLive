package live.trackme.app.ui.signup

import androidx.compose.runtime.Immutable
import live.trackme.app.NameProblem
import live.trackme.app.domain.Country

enum class SignUpStep {
    /** Name and mobile number. */
    Details,

    /** The 6-digit code. */
    Code,
}

/** Why the number field shows its error; [example] is the country's example mobile number, if it has one. */
data class NumberError(val example: String?)

enum class Problem {
    /** No connection, or the server didn't answer: check the connection and try again. */
    Network,

    /** Too many codes or tries: wait a few minutes. */
    TooManyRequests,
}

/** The line under the code field. */
sealed interface CodeStatus {
    data object Idle : CodeStatus

    /** Checking the code, then setting up or restoring the account. */
    data object Checking : CodeStatus

    data object Wrong : CodeStatus

    data object Expired : CodeStatus

    data object NewCodeSent : CodeStatus

    /** The code couldn't be checked; Try again checks the same code. */
    data class CheckFailed(val problem: Problem) : CodeStatus

    /** A new code couldn't be sent. */
    data class SendFailed(val problem: Problem) : CodeStatus
}

/**
 * Everything sign-up shows except the three text values, which live in the view model as Compose state
 * (see [SignUpViewModel]).
 */
@Immutable
data class SignUpUiState(
    val step: SignUpStep = SignUpStep.Details,
    val country: Country,
    /** Shown once the name field is left after an edit, or on Send code. */
    val nameProblem: NameProblem? = null,
    val numberError: NumberError? = null,
    /** Send code failed; the button reads Try again. */
    val sendProblem: Problem? = null,
    val sending: Boolean = false,
    /** The number the code went to, international format. */
    val sentTo: String = "",
    val codeStatus: CodeStatus = CodeStatus.Idle,
    /** Seconds until Send a new code; 0 shows the button. */
    val resendSecondsLeft: Int = 0,
    /** The code expired: Send a new code shows at once, whatever the countdown says. */
    val codeExpired: Boolean = false,
    val resending: Boolean = false,
    /** The number was confirmed but the account couldn't be set up; Try again retries just that. */
    val finishFailed: Boolean = false,
    /** The account is being set up or restored after the number was confirmed without a code. */
    val finishing: Boolean = false,
    /**
     * The number is already confirmed (a sign-up interrupted before its profile was saved): only the
     * name is asked for, and Continue saves the profile without another text.
     */
    val numberConfirmed: Boolean = false,
    /** The server ended the last sign-in: "Your sign-in has ended. Sign in again." until Send code. */
    val signInEnded: Boolean = false,
) {
    val canResend: Boolean get() = codeExpired || resendSecondsLeft == 0
}

/** One-off requests from the view model to the screen. */
sealed interface SignUpEffect {
    /** Move focus to a field: the first invalid one after Send code, or the code field. */
    data class Focus(val field: Field) : SignUpEffect

    enum class Field { Name, Number, Code }
}
