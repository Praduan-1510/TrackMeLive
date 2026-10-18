package live.trackme.app.ui.signup

import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.LocalTime
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.domain.Clock
import live.trackme.app.domain.PhoneNumbers
import live.trackme.app.fakes.FakeAuthRepository
import live.trackme.app.fakes.FakeLocalPreferences
import live.trackme.app.fakes.FakeProfileRepository
import live.trackme.app.ui.assertNoTextIsCut
import live.trackme.app.ui.setTmlContent
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Sign-up as someone uses it: the real view model and screens, with fake Firebase underneath. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp-xxhdpi")
class SignUpScreenTest {
    @get:Rule val rule = createComposeRule()

    private val auth = FakeAuthRepository(validCode = "482913")
    private val profiles = FakeProfileRepository()
    private val prefs = FakeLocalPreferences(SetupStage.SignUp)
    private var backedOut = false

    /** Time stands still: the resend countdown stays at 0:30. */
    private val clock = object : Clock {
        override fun elapsedMillis(): Long = 0
        override fun localTime(): LocalTime = LocalTime.NOON
    }

    private fun show(fontScale: Float = 1f) {
        val vm = SignUpViewModel(auth, profiles, prefs, PhoneNumbers(), clock, "US", SavedStateHandle())
        rule.setTmlContent(fontScale = fontScale) {
            SignUpRoute(onBackToOnboarding = { backedOut = true }, vm = vm)
        }
    }

    private fun field(label: String) = rule.onNode(hasSetTextAction() and hasText(label))

    private fun withError(message: String) = SemanticsMatcher.expectValue(SemanticsProperties.Error, message)

    @Test
    fun happyPathCreatesTheAccountAndMovesOnToTheMascot() {
        show()
        rule.onNodeWithText("Create your account").assertIsDisplayed()
        field("Name").performTextInput("Alex")
        field("Mobile number").performTextInput("4155550142")
        // Drawn formatted, stored as digits.
        rule.onNodeWithText("(415) 555-0142").assertIsDisplayed()
        rule.onNodeWithText("Send code").performClick()

        rule.onNodeWithText("Enter the code").assertIsDisplayed()
        rule.onNodeWithText("Sent by text to", substring = true).assertIsDisplayed()
        rule.onNodeWithText("You can send a new code in 0:30.").assertIsDisplayed()
        assertEquals(listOf("+14155550142" to false), auth.sent)

        rule.onNode(hasContentDescription("6-digit code")).performTextInput("482913")
        rule.waitUntil { prefs.setupStage.value == SetupStage.Mascot }
        assertEquals(listOf("Alex"), profiles.created)
    }

    @Test
    fun aWrongCodeSaysSoUnderTheField() {
        show()
        field("Name").performTextInput("Alex")
        field("Mobile number").performTextInput("4155550142")
        rule.onNodeWithText("Send code").performClick()

        val code = rule.onNode(hasContentDescription("6-digit code"))
        code.performTextInput("111111")
        rule.onNodeWithText("That code didn’t work. Check the text and try again.").assertIsDisplayed()
        // The field keeps focus (and the keyboard) for the next try.
        code.assertIsFocused()
        // TalkBack hears the error on the field itself, too.
        rule.onNode(hasContentDescription("6-digit code") and withError("That code didn’t work. Check the text and try again.")).assertExists()
        assertEquals(SetupStage.SignUp, prefs.setupStage.value)

        // Typing the right one goes on.
        code.performTextInput("482913")
        rule.waitUntil { prefs.setupStage.value == SetupStage.Mascot }
    }

    @Test
    fun anIncompleteNumberIsCaughtBeforeAnyTextIsSent() {
        show()
        field("Name").performTextInput("Alex")
        field("Mobile number").performTextInput("41555")
        rule.onNodeWithText("Send code").performClick()
        rule.onNodeWithText("Enter your full mobile number, like (201) 555-0123.").assertIsDisplayed()
        assertEquals(emptyList<Pair<String, Boolean>>(), auth.sent)
    }

    @Test
    fun anEmptyNameIsCaughtFirst() {
        show()
        field("Mobile number").performTextInput("4155550142")
        rule.onNodeWithText("Send code").performClick()
        rule.onNodeWithText("Enter your name. It’s what people see when you share.").assertIsDisplayed()
    }

    @Test
    fun backFromTheFirstStepReturnsToOnboarding() {
        show()
        rule.onNode(hasContentDescription("Back")).performClick()
        rule.waitUntil { backedOut }
    }

    @Test
    fun nothingIsCutAtTwiceTheFontSize() {
        show(fontScale = 2f)
        rule.assertNoTextIsCut()
    }
}
