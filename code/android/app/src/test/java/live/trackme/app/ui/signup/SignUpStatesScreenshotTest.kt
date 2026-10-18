package live.trackme.app.ui.signup

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import live.trackme.app.NameProblem
import live.trackme.app.domain.Country
import live.trackme.app.domain.PhoneNumbers
import live.trackme.app.ui.Figtree
import live.trackme.app.ui.Gabarito
import live.trackme.design.TmlTheme
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * PNGs of the sign-up states that the Firebase emulators can't produce on demand (an expired code, too
 * many tries, a profile that couldn't be saved, an interrupted sign-up), in light and dark, for review
 * next to the emulator screenshots. Runs only with -Ptml.screenshots=<dir>.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp-xxhdpi")
class SignUpStatesScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    /** Draws the window in software (Robolectric's native graphics) into a bitmap. */
    private fun snapshot(): Bitmap {
        val view = rule.activity.window.decorView
        return Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
    }

    private val out = System.getProperty("tml.screenshots")?.let(::File)
    private val numbers = PhoneNumbers()
    private val us = Country("US", 1, "United States")
    private val code = SignUpUiState(step = SignUpStep.Code, country = us, sentTo = "+1 650-555-0142", resendSecondsLeft = 18)

    private val states: List<Triple<String, SignUpUiState, String>> = listOf(
        Triple("code-expired", code.copy(codeStatus = CodeStatus.Expired, codeExpired = true), ""),
        Triple("code-too-many", code.copy(codeStatus = CodeStatus.CheckFailed(Problem.TooManyRequests)), ""),
        Triple("code-check-failed", code.copy(codeStatus = CodeStatus.CheckFailed(Problem.Network)), "482913"),
        Triple("code-finish-failed", code.copy(finishFailed = true), "482913"),
        Triple("code-checking", code.copy(codeStatus = CodeStatus.Checking), "482913"),
        Triple("code-resend-failed", code.copy(codeStatus = CodeStatus.SendFailed(Problem.Network), resendSecondsLeft = 0), ""),
        Triple("details-too-many", SignUpUiState(country = us, sendProblem = Problem.TooManyRequests), ""),
        Triple("details-no-letters", SignUpUiState(country = us, nameProblem = NameProblem.NoLetters), ""),
        Triple("details-interrupted", SignUpUiState(country = us, numberConfirmed = true), ""),
    )

    @Test
    fun writeScreenshots() {
        assumeTrue("pass -Ptml.screenshots=<dir> to write them", out != null)
        val dir = out!!.apply { mkdirs() }
        var current by mutableStateOf(states.first())
        var dark by mutableStateOf(false)
        rule.setContent {
            TmlTheme(darkTheme = dark, display = Gabarito, text = Figtree) {
                val (_, state, typed) = current
                SignUpScreen(
                    state = state,
                    name = if (state.nameProblem == NameProblem.NoLetters) "..." else "Alex",
                    phoneDigits = "6505550142",
                    code = typed,
                    countries = { numbers.countries() },
                    formatPhone = numbers::formatAsYouType,
                    filterCountries = numbers::filter,
                    actions = SignUpActions({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}),
                    focus = SignUpFocus(FocusRequester(), FocusRequester(), FocusRequester()),
                )
            }
        }
        for (theme in listOf(false, true)) {
            for (entry in states) {
                dark = theme
                current = entry
                rule.waitForIdle()
                val bitmap = snapshot()
                File(dir, "${entry.first}-${if (theme) "dark" else "light"}.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
            }
        }
    }
}
