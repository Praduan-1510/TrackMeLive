package live.trackme.app.ui.ended

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.TimeZone
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.app.ui.assertNoTextIsCut
import live.trackme.app.ui.setTmlContent
import live.trackme.app.ui.share.Audience
import live.trackme.schema.EndReason
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp-xxhdpi")
class EndedScreenTest {
    @get:Rule val rule = createComposeRule()

    private val zone = TimeZone.getDefault()
    private val start = FakeSharingRepository.START_MILLIS // 9:38 pm UTC
    private val minute = 60_000L

    @Before fun utc() = TimeZone.setDefault(TimeZone.getTimeZone("UTC"))

    @After fun restore() = TimeZone.setDefault(zone)

    private val stopped = EndedUiState(
        ended = true,
        reason = EndReason.STOPPED,
        audience = Audience("Mom"),
        startedAtMillis = start,
        endedAtMillis = start + 14 * minute,
    )
    private var state by mutableStateOf(stopped)
    private val reported = mutableListOf<String>()

    private fun show(initial: EndedUiState = stopped, fontScale: Float = 1f, dark: Boolean = false) {
        state = initial
        rule.setTmlContent(fontScale = fontScale, dark = dark) {
            EndedScreen(state = state, onDone = { reported += "done" }, onShareAgain = { reported += "again" })
        }
    }

    private val heading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)

    @Test
    fun stoppedSaysWhenAndSummarizes() {
        show()
        rule.onNode(hasText("Sharing ended") and heading).assertIsDisplayed()
        rule.onNodeWithText("You stopped sharing at 9:52 pm.").assertIsDisplayed()
        rule.onNode(hasText("Shared with") and hasText("Mom")).assertIsDisplayed()
        rule.onNode(hasText("Shared for") and hasText("14 min")).assertIsDisplayed()
        rule.onNode(hasText("Mom opened it") and hasText("Not opened")).assertIsDisplayed()
        rule.onNode(hasText("Mom shared back") and hasText("No")).assertIsDisplayed()
        rule.onNodeWithText("Location points from this session are deleted by 9:52 pm tomorrow.").assertIsDisplayed()
        rule.onNodeWithText("Share again").assertDoesNotExist()
        rule.onNode(hasText("Done") and hasClickAction()).performClick()
        assertEquals(listOf("done"), reported)
    }

    @Test
    fun eachReasonSaysWhy() {
        show(stopped.copy(reason = EndReason.TIMER))
        rule.onNodeWithText("Your timer ran out, so sharing stopped.").assertIsDisplayed()
        state = stopped.copy(reason = EndReason.CALL)
        rule.onNodeWithText("Your call ended, so sharing stopped.").assertIsDisplayed()
        rule.onNode(hasText("Sharing ended") and heading).assertIsDisplayed()
    }

    @Test
    fun theLimitOffersShareAgain() {
        show(stopped.copy(reason = EndReason.LIMIT, endedAtMillis = start + 60 * minute))
        rule.onNode(hasText("Sharing stopped after 1 hour") and heading).assertIsDisplayed()
        rule.onNodeWithText("That’s the longest a link can run. Share again to send a new link.").assertIsDisplayed()
        rule.onNode(hasText("Shared for") and hasText("60 min")).assertIsDisplayed()
        rule.onNode(hasText("Share again") and hasClickAction()).performClick()
        rule.onNode(hasText("Done") and hasClickAction()).performClick()
        assertEquals(listOf("again", "done"), reported)
    }

    @Test
    fun withoutANameTheRowsSayTheLink() {
        show(stopped.copy(audience = Audience.None, openedAtMillis = start + minute, sharedBack = true))
        rule.onNodeWithText("Shared with").assertDoesNotExist()
        rule.onNode(hasText("Link opened") and hasText("9:39 pm")).assertIsDisplayed()
        rule.onNode(hasText("Shared back") and hasText("Yes")).assertIsDisplayed()
    }

    @Test
    fun nothingIsCutAtTwiceTheTextSize() {
        show(stopped.copy(reason = EndReason.LIMIT), fontScale = 2f)
        rule.assertNoTextIsCut()
        rule.onNode(hasText("Done") and hasClickAction()).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun nothingIsCutInDarkAtTwiceTheTextSize() {
        show(stopped.copy(audience = Audience("Alexandria Montgomery-W")), fontScale = 2f, dark = true)
        rule.assertNoTextIsCut()
    }
}
