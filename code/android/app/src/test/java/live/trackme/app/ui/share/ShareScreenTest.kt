package live.trackme.app.ui.share

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.ui.MinTouch
import live.trackme.app.ui.assertNoTextIsCut
import live.trackme.app.ui.setTmlContent
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp-xxhdpi")
class ShareScreenTest {
    @get:Rule val rule = createComposeRule()

    private var state by mutableStateOf(ShareUiState())
    private var name by mutableStateOf("")
    private val reported = mutableListOf<Any>()

    private fun show(initial: ShareUiState = ShareUiState(), viewer: String = "", fontScale: Float = 1f, dark: Boolean = false) {
        state = initial
        name = viewer
        rule.setTmlContent(fontScale = fontScale, dark = dark) {
            ShareScreen(
                state = state,
                viewerName = name,
                actions = ShareActions(
                    onBack = { reported += "back" },
                    onViewerNameChange = { name = it; reported += "name:$it" },
                    onClearViewerName = { name = ""; reported += "clear" },
                    onStopChange = { state = state.copy(stop = it); reported += it },
                    onPrecisionChange = { state = state.copy(precision = it); reported += it },
                    onShare = { reported += "share" },
                ),
            )
        }
    }

    @Test
    fun showsThePrototypesCopy() {
        show()
        rule.onNodeWithText("Share where you are").assertIsDisplayed()
        rule.onNodeWithText("Whoever gets the link follows you live in their browser. No app needed.").assertIsDisplayed()
        rule.onNodeWithText("They see you move as you go", substring = true).assertIsDisplayed()
        rule.onNode(hasContentDescription("Sharing live")).assertIsDisplayed()
        rule.onNode(hasSetTextAction() and hasText("Who it’s for (optional)")).assertIsDisplayed()
        rule.onNodeWithText("Only you see the name. They see your name and mascot.").assertIsDisplayed()
        rule.onNode(hasClickAction() and hasText("Stops") and hasText("In 30 min")).assertIsDisplayed()
        rule.onNodeWithText("Location").assertIsDisplayed()
        rule.onNode(hasText("Share live location") and hasClickAction()).assertIsDisplayed()
        rule.onNodeWithText("Next, choose who gets the link.").assertIsDisplayed()
    }

    @Test
    fun backSaysWhereItGoes() {
        show()
        rule.onNode(hasContentDescription("Home")).assertHeightIsAtLeast(MinTouch).assertWidthIsAtLeast(MinTouch).performClick()
        assertEquals(listOf<Any>("back"), reported)
    }

    @Test
    fun theNameFieldTypesAndClears() {
        show()
        rule.onNode(hasContentDescription("Clear the name")).assertDoesNotExist()
        rule.onNode(hasSetTextAction()).performTextInput("Mom")
        assertEquals("name:Mom", reported.last())
        rule.onNode(hasContentDescription("Clear the name"))
            .assertHeightIsAtLeast(MinTouch)
            .assertWidthIsAtLeast(MinTouch)
            .performClick()
        assertEquals("clear", reported.last())
        rule.onNode(hasContentDescription("Clear the name")).assertDoesNotExist()
    }

    @Test
    fun aNameWithoutLettersSaysSoUnderTheField() {
        show(ShareUiState(nameError = true), viewer = "...")
        rule.onNodeWithText("Use at least one letter or number, or leave the name empty.").assertIsDisplayed()
    }

    @Test
    fun stopsOpensTheTimerSheet() {
        show()
        rule.onNode(hasClickAction() and hasText("Stops")).performClick()
        rule.onNodeWithText("When sharing stops").assertIsDisplayed()
        rule.onNodeWithText("Sharing never runs longer than 1 hour.").assertIsDisplayed()
        val radio = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton)
        rule.onNode(radio and hasText("In 30 min")).assertIsSelected()
        rule.onNode(radio and hasText("In 1 hour")).performClick()
        rule.waitForIdle()
        assertEquals(StopChoice.After(StopMinutes.MINUTES_60), reported.last())
        rule.onNodeWithText("When sharing stops").assertDoesNotExist()
        rule.onNode(hasClickAction() and hasText("In 1 hour")).assertIsDisplayed()
    }

    @Test
    fun locationIsPreciseOrApproximate() {
        show()
        rule.onNodeWithText("Approximate").performScrollTo().performClick()
        assertEquals(Precision.APPROXIMATE, reported.last())
    }

    @Test
    fun shareReportsAndWaitsWhileBusy() {
        show()
        rule.onNode(hasText("Share live location") and hasClickAction()).performClick()
        assertEquals("share", reported.last())
        state = state.copy(busy = true)
        rule.onNode(hasText("Share live location") and hasClickAction()).assertIsNotEnabled()
    }

    @Test
    fun eachFailureSaysWhatHappened() {
        show()
        mapOf(
            ShareError.Network to "We couldn’t start sharing. Check your connection, then try again.",
            ShareError.AlreadySharing to "You’re already sharing from another phone. Stop that share first, then try again.",
            ShareError.Location to "Track Me Live can’t use your location yet. Allow it, then try again.",
            ShareError.Other to "Sharing didn’t start. Try again.",
        ).forEach { (error, text) ->
            state = state.copy(error = error)
            rule.onNodeWithText(text).assertIsDisplayed()
        }
    }

    @Test
    fun nothingIsCutAtTwiceTheTextSize() {
        show(ShareUiState(error = ShareError.Network), viewer = "Alexandria Montgomery-W", fontScale = 2f)
        rule.assertNoTextIsCut()
        rule.onNode(hasText("Share live location") and hasClickAction()).assertIsDisplayed()
    }

    @Test
    fun nothingIsCutInDarkAtTwiceTheTextSize() {
        show(ShareUiState(precision = Precision.APPROXIMATE), viewer = "Mom", fontScale = 2f, dark = true)
        rule.assertNoTextIsCut()
        rule.onNode(hasText("Share live location") and hasClickAction()).assertIsDisplayed()
    }

    @Test
    fun backWaitsWhileTheLinkIsBeingMade() {
        show(ShareUiState(busy = true))
        rule.onNode(hasContentDescription("Home")).performClick()
        assertEquals(emptyList<Any>(), reported.filter { it == "back" })
    }
}
