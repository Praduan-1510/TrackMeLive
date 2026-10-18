package live.trackme.app.ui.live

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.TimeZone
import live.trackme.app.data.sharing.SharedPoint
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.app.ui.MinTouch
import live.trackme.app.ui.assertNoTextIsCut
import live.trackme.app.ui.setTmlContent
import live.trackme.app.ui.share.Audience
import live.trackme.app.ui.share.ShareSheetContent
import live.trackme.app.ui.share.StopChoices
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
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
class LiveScreenTest {
    @get:Rule val rule = createComposeRule()

    private val zone = TimeZone.getDefault()
    private val start = FakeSharingRepository.START_MILLIS // 9:38 pm UTC
    private val minute = 60_000L

    @Before fun utc() = TimeZone.setDefault(TimeZone.getTimeZone("UTC"))

    @After fun restore() = TimeZone.setDefault(zone)

    private val waiting = LiveUiState(
        live = true,
        audience = Audience("Mom"),
        nowMillis = start + 5 * minute,
        startedAtMillis = start,
        expiresAtMillis = start + 60 * minute,
        endsAtMillis = start + 30 * minute,
        stop = StopChoice.After(StopMinutes.MINUTES_30),
        stopOptions = StopChoices.whileSharing(start + 5 * minute, start + 60 * minute),
        intervalSeconds = 3.5,
        point = SharedPoint(37.8, -122.4, 8.0, start + 5 * minute, Precision.PRECISE),
        link = ShareSheetContent("https://trackme.live/s/AAAA", "Alex"),
    )

    private var state by mutableStateOf(waiting)
    private val reported = mutableListOf<Any>()

    private fun show(initial: LiveUiState = waiting, fontScale: Float = 1f, dark: Boolean = false) {
        state = initial
        rule.setTmlContent(fontScale = fontScale, dark = dark) {
            LiveScreen(
                state = state,
                actions = LiveActions(
                    onBack = { reported += "back" },
                    onPrecisionChange = { reported += it },
                    onStopChange = { reported += it },
                    onSendAgain = { reported += "send" },
                    onStop = { reported += "stop"; state = state.copy(confirmingStop = true) },
                    onStopConfirmed = { reported += "confirmed" },
                    onStopCancelled = { reported += "cancelled"; state = state.copy(confirmingStop = false) },
                    onAlertsYes = { reported += "alerts" },
                    onAlertsNotNow = { reported += "notNow"; state = state.copy(askAlerts = false) },
                ),
            )
        }
    }

    @Test
    fun aLinkNotOpenedYet() {
        show()
        rule.onNodeWithText("Stops at 10:08 pm").assertIsDisplayed()
        rule.onNode(hasText("Sharing live") and SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)).assertIsDisplayed()
        rule.onNode(hasContentDescription("Sharing live")).assertIsDisplayed()
        rule.onNode(
            hasText("Link sent to Mom. You’ll know when it’s opened.") and
                SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
        ).assertIsDisplayed()
        rule.onNode(hasContentDescription("Distance not shared")).assertIsDisplayed()
        rule.onNode(hasContentDescription("Sharing for 5 minutes")).assertIsDisplayed()
        rule.onNode(hasContentDescription("Stops at 10:08 pm")).assertIsDisplayed()
        rule.onNode(hasContentDescription("You, Live, Precise, updates every 3.5 seconds")).assertIsDisplayed()
        rule.onNode(hasContentDescription("Mom, Waiting, Link sent, not opened yet")).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Mom can share back only when you start sharing during a call.").performScrollTo().assertIsDisplayed()
        rule.onNode(hasContentDescription("You, live")).assertIsDisplayed() // the marker
        rule.onNodeWithText("Sharing stops at", substring = true).assertDoesNotExist()
    }

    @Test
    fun withoutANameItSaysThey() {
        show(waiting.copy(audience = Audience.None))
        rule.onNodeWithText("Link sent. You’ll know when it’s opened.").assertIsDisplayed()
        rule.onNode(hasContentDescription("Them, Waiting, Link sent, not opened yet")).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("They can share back only when you start sharing during a call.").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun anOpenedLinkSaysWhen() {
        show(waiting.copy(openedAtMillis = start + 2 * minute))
        rule.onNodeWithText("Mom opened your link at 9:40 pm.").assertIsDisplayed()
        rule.onNode(hasContentDescription("Mom, Watching, Opened at 9:40 pm")).performScrollTo().assertIsDisplayed()
        state = state.copy(audience = Audience.None)
        rule.onNodeWithText("They opened your link at 9:40 pm.").assertIsDisplayed()
    }

    @Test
    fun noConnectionAndNoSignalAreSaidInWords() {
        show(waiting.copy(signal = SharerSignal.Offline))
        rule.onNode(hasContentDescription("No connection")).assertIsDisplayed()
        rule.onNodeWithText("No connection right now. Mom will see where you were last seen when they open the link.").assertIsDisplayed()
        rule.onNode(hasContentDescription("You, Last seen, No connection")).assertIsDisplayed()
        rule.onNode(hasContentDescription("You, last seen 9:43 pm")).assertIsDisplayed()

        state = waiting.copy(signal = SharerSignal.NoGps, openedAtMillis = start)
        rule.onNode(hasContentDescription("No GPS signal")).assertIsDisplayed()
        rule.onNodeWithText("No GPS signal right now. Mom sees where you were last seen.").assertIsDisplayed()
        rule.onNode(hasContentDescription("You, Last seen, No GPS signal")).assertIsDisplayed()
    }

    @Test
    fun theOneHourWarningIsAQuietAnnouncedLine() {
        show(waiting.copy(endsAtMillis = start + 60 * minute, stop = StopChoice.AtLimit, limitSoon = true, nowMillis = start + 56 * minute))
        rule.onNode(
            hasText("Sharing stops at 10:38 pm · 1-hour limit") and
                SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
            useUnmergedTree = false,
        ).assertIsDisplayed()
        rule.onNode(hasContentDescription("Sharing for 56 minutes")).assertIsDisplayed()
    }

    @Test
    fun aPrecisionChangeSaysWhenItTakesEffect() {
        show(waiting.copy(precisionShown = Precision.APPROXIMATE))
        rule.onNodeWithText("Approximate from the next update").performScrollTo().assertIsDisplayed()
        state = waiting.copy(precision = Precision.APPROXIMATE, precisionShown = Precision.PRECISE)
        rule.onNodeWithText("Precise from the next update").performScrollTo().assertIsDisplayed()
        state = waiting
        rule.onNodeWithText("from the next update", substring = true).assertDoesNotExist()
        rule.onNodeWithText("Approximate").performScrollTo().performClick()
        assertEquals(Precision.APPROXIMATE, reported.last())
    }

    @Test
    fun stopAsksFirst() {
        show()
        rule.onNode(hasText("Stop sharing") and hasClickAction()).assertHeightIsAtLeast(MinTouch).performClick()
        rule.onNodeWithText("Stop sharing your location?").assertIsDisplayed()
        rule.onNodeWithText("Your link will stop working.").assertIsDisplayed()
        rule.onNodeWithText("Cancel").performClick()
        assertEquals(listOf<Any>("stop", "cancelled"), reported)
        rule.onNodeWithText("Stop sharing your location?").assertDoesNotExist()

        state = state.copy(openedAtMillis = start, confirmingStop = true)
        rule.onNodeWithText("Mom will see that sharing ended.").assertIsDisplayed()
        rule.onNodeWithText("Stop").performClick()
        assertEquals("confirmed", reported.last())

        state = state.copy(audience = Audience.None)
        rule.onNodeWithText("They’ll see that sharing ended.").assertIsDisplayed()
    }

    @Test
    fun changeTimerOffersWhatStillFitsBeforeTheLimit() {
        show()
        rule.onNodeWithText("Change timer").performScrollTo().performClick()
        rule.onNodeWithText("When sharing stops").assertIsDisplayed()
        rule.onNodeWithText("In 1 hour").assertDoesNotExist()
        rule.onNodeWithText("At the 1-hour limit · 10:38 pm").performClick()
        rule.waitForIdle()
        assertEquals(StopChoice.AtLimit, reported.last())
    }

    @Test
    fun backAndSendLinkAgain() {
        show()
        rule.onNodeWithText("Send link again").performScrollTo().performClick()
        rule.onNode(hasContentDescription("Home")).performClick()
        assertEquals(listOf<Any>("send", "back"), reported)
    }

    @Test
    fun alertsAreAskedForRightAfterTheLinkWentOut() {
        show(waiting.copy(askAlerts = true))
        rule.onNodeWithText("Know when Mom opens it").assertIsDisplayed()
        rule.onNodeWithText("Turn on alerts to hear when your link is opened, when a call ends while you’re sharing, and when sharing stops.").assertIsDisplayed()
        rule.onNodeWithText("Not now").performClick()
        rule.waitForIdle()
        assertEquals("notNow", reported.last())

        state = waiting.copy(askAlerts = true, audience = Audience.None)
        rule.onNodeWithText("Know when your link is opened").assertIsDisplayed()
        rule.onNodeWithText("Turn on alerts").performClick()
        rule.waitForIdle()
        assertEquals("alerts", reported.last())
    }

    @Test
    fun stopSharingStaysReachableAtTwiceTheTextSize() {
        show(waiting.copy(limitSoon = true, precisionShown = Precision.APPROXIMATE), fontScale = 2f)
        rule.onNode(hasText("Stop sharing") and hasClickAction()).assertIsDisplayed()
        rule.assertNoTextIsCut()
    }

    @Test
    fun nothingIsCutInDarkAtTwiceTheTextSize() {
        show(waiting.copy(openedAtMillis = start, signal = SharerSignal.NoGps), fontScale = 2f, dark = true)
        rule.onNode(hasText("Stop sharing") and hasClickAction()).assertIsDisplayed()
        rule.assertNoTextIsCut()
    }
}
