package live.trackme.app.ui.share

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.schema.DefaultStop
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import live.trackme.schema.StopRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** The share screens' rules: stop choices, times, durations, names, and how the share sheet closed. */
@RunWith(AndroidJUnit4::class)
class ShareRulesTest {
    private val res = ApplicationProvider.getApplicationContext<Context>().resources
    private val utc = ZoneId.of("UTC")
    private fun at(h: Int, m: Int) = LocalDateTime.of(2026, 10, 17, h, m).toEpochSecond(ZoneOffset.UTC) * 1000

    // ---------- Stop choices ----------

    @Test
    fun beforeSharingEveryTimerIsOffered() {
        assertEquals(
            listOf(StopChoice.After(StopMinutes.MINUTES_15), StopChoice.After(StopMinutes.MINUTES_30), StopChoice.After(StopMinutes.MINUTES_60)),
            StopChoices.beforeSharing,
        )
    }

    @Test
    fun whileSharingOnlyTimersThatEndBeforeTheLimitThenTheLimit() {
        val start = 0L
        val expires = 60 * 60_000L
        assertEquals(
            listOf(StopChoice.After(StopMinutes.MINUTES_15), StopChoice.After(StopMinutes.MINUTES_30), StopChoice.AtLimit),
            StopChoices.whileSharing(start + 1, expires),
        )
        // In 1 hour would pass the limit at once; exactly at the limit isn't "before" it either.
        assertEquals(listOf(StopChoice.After(StopMinutes.MINUTES_15), StopChoice.AtLimit), StopChoices.whileSharing(30 * 60_000L, expires))
        assertEquals(listOf(StopChoice.AtLimit), StopChoices.whileSharing(45 * 60_000L, expires))
        assertEquals(listOf(StopChoice.AtLimit), StopChoices.whileSharing(59 * 60_000L, expires))
    }

    @Test
    fun theDefaultComesFromSettingsAndACallDefaultIsThirtyMinutes() {
        assertEquals(StopChoice.After(StopMinutes.MINUTES_30), StopChoices.fromDefault(DefaultStop.CALL))
        assertEquals(StopChoice.After(StopMinutes.MINUTES_15), StopChoices.fromDefault(DefaultStop.MINUTES_15))
        assertEquals(StopChoice.After(StopMinutes.MINUTES_30), StopChoices.fromDefault(DefaultStop.MINUTES_30))
        assertEquals(StopChoice.After(StopMinutes.MINUTES_60), StopChoices.fromDefault(DefaultStop.MINUTES_60))
    }

    @Test
    fun aRunningSessionsChoice() {
        fun session(stop: StopChoice) = ShareRequest(stop, Precision.PRECISE, false).let {
            FakeSharingRepository.sessionFor(FakeSharingRepository.shareFor(it), it)
        }
        assertEquals(StopChoice.After(StopMinutes.MINUTES_15), StopChoices.ofSession(session(StopChoice.After(StopMinutes.MINUTES_15))))
        assertEquals(StopChoice.AtLimit, StopChoices.ofSession(session(StopChoice.AtLimit)))
        assertEquals(StopChoice.WhenCallEnds, StopChoices.ofSession(session(StopChoice.WhenCallEnds)))
        // A 60-minute timer from the start ends at the limit, so it reads as the limit.
        assertEquals(StopChoice.AtLimit, StopChoices.ofSession(session(StopChoice.After(StopMinutes.MINUTES_60))))
        // A minutes rule without its minutes (never written that way) falls back to 30.
        val odd = session(StopChoice.After(StopMinutes.MINUTES_15)).copy(stopRule = StopRule.MINUTES, stopMinutes = null)
        assertEquals(StopChoice.After(StopMinutes.MINUTES_30), StopChoices.ofSession(odd))
    }

    // ---------- Times and durations ----------

    @Test
    fun clockTimesFollowTheTwelveOrTwentyFourHourSetting() {
        val twelve = ShareFormats(res, is24Hour = false, zone = utc)
        assertEquals("9:38 pm", twelve.clock(at(21, 38)))
        assertEquals("9:05 am", twelve.clock(at(9, 5)))
        assertEquals("12:00 am", twelve.clock(at(0, 0)))
        assertEquals("12:30 pm", twelve.clock(at(12, 30)))
        val twentyFour = ShareFormats(res, is24Hour = true, zone = utc)
        assertEquals("21:38", twentyFour.clock(at(21, 38)))
        assertEquals("09:05", twentyFour.clock(at(9, 5)))
        assertEquals("00:00", twentyFour.clock(at(0, 0)))
    }

    @Test
    fun durationsAreWholeMinutesToTheEyeAndWordsToTalkBack() {
        val f = ShareFormats(res, is24Hour = false, zone = utc)
        assertEquals("< 1 min", f.duration(59_999))
        assertEquals("< 1 min", f.duration(-5_000))
        assertEquals("1 min", f.duration(60_000))
        assertEquals("56 min", f.duration(56 * 60_000L + 59_000))
        assertEquals("less than a minute", f.durationSpoken(30_000))
        assertEquals("1 minute", f.durationSpoken(90_000))
        assertEquals("5 minutes", f.durationSpoken(5 * 60_000L))
    }

    @Test
    fun pingIntervalsDropATrailingZero() {
        assertEquals("3.5", ShareFormats.seconds(3.5))
        assertEquals("5", ShareFormats.seconds(5.0))
        assertEquals("60", ShareFormats.seconds(60.0))
        assertEquals("3.3", ShareFormats.seconds(3.333))
    }

    // ---------- Who it's for ----------

    @Test
    fun theAudienceIsTheTidiedNameOrNone() {
        assertEquals(Audience("Mom R"), Audience.of("  Mom   R "))
        assertEquals(Audience.None, Audience.of("   "))
        assertEquals(Audience.None, Audience.of(null))
    }

    @Test
    fun theViewersInitialIsALetterOrDigitOrAPersonIcon() {
        assertEquals("M", Audience("mom").initial)
        assertEquals("7", Audience("7 Dwarfs").initial)
        assertEquals(text(0x45, 0x301), Audience(text(0x65, 0x301) + "lise").initial)
        assertEquals("Ö", Audience("Ömer").initial)
        assertNull("an emoji gets the person icon", Audience(text(0x1F469, ZWJ, 0x1F4BB) + " Sam").initial)
        assertNull("a symbol gets the person icon", Audience("@home").initial)
        assertNull(Audience.None.initial)
    }

    @Test
    fun namesAreIsolatedInSentences() {
        val hebrew = text(0x5D3, 0x5E0, 0x5D4)
        val isolated = Audience(hebrew).inSentence!!
        assertTrue(isolated.contains(hebrew))
        assertTrue("wrapped in direction marks", isolated.length > hebrew.length)
        assertNull(Audience.None.inSentence)
    }

    // ---------- The share sheet ----------

    @Test
    fun anAppChosenOrACopyCountsAsSent() {
        assertEquals(ShareSheetOutcome.Sent, shareSheetOutcome(targetChosen = true, clipTimestampMillis = null, openedAtMillis = 1_000))
        assertEquals(ShareSheetOutcome.Sent, shareSheetOutcome(targetChosen = false, clipTimestampMillis = 1_500, openedAtMillis = 1_000))
        assertEquals(ShareSheetOutcome.Sent, shareSheetOutcome(targetChosen = false, clipTimestampMillis = 1_000, openedAtMillis = 1_000))
        // An older clip, or none: nothing was chosen.
        assertEquals(ShareSheetOutcome.Closed, shareSheetOutcome(targetChosen = false, clipTimestampMillis = 999, openedAtMillis = 1_000))
        assertEquals(ShareSheetOutcome.Closed, shareSheetOutcome(targetChosen = false, clipTimestampMillis = null, openedAtMillis = 1_000))
        // Not knowing when the sheet opened (never stamped): a clip proves nothing; a chosen app still does.
        assertEquals(ShareSheetOutcome.Closed, shareSheetOutcome(targetChosen = false, clipTimestampMillis = 5_000, openedAtMillis = 0))
        assertEquals(ShareSheetOutcome.Sent, shareSheetOutcome(targetChosen = true, clipTimestampMillis = null, openedAtMillis = 0))
    }

    @Test
    fun theSheetCarriesTheMessageTheLinkAndThePreviewTitle() {
        val content = ShareSheetContent("https://trackme.live/s/AAAA", "Alex")
        assertEquals("I’m sharing my live location with you. https://trackme.live/s/AAAA", content.message(res))
        assertEquals("Alex · Live location", content.title(res))
        val context = ApplicationProvider.getApplicationContext<Context>()
        val chooser = chooserIntent(context, content)
        assertEquals(android.content.Intent.ACTION_CHOOSER, chooser.action)
        @Suppress("DEPRECATION")
        val send = chooser.getParcelableExtra<android.content.Intent>(android.content.Intent.EXTRA_INTENT)!!
        assertEquals(android.content.Intent.ACTION_SEND, send.action)
        assertEquals("text/plain", send.type)
        assertEquals(content.message(res), send.getStringExtra(android.content.Intent.EXTRA_TEXT))
        assertEquals("Alex · Live location", send.getStringExtra(android.content.Intent.EXTRA_TITLE))
    }

    /** A string from code points, so no invisible or combining character is ever typed into this file. */
    private fun text(vararg codePoints: Int): String = String(codePoints, 0, codePoints.size)

    private companion object {
        /** U+200D ZERO WIDTH JOINER. */
        const val ZWJ = 0x200D
    }
}
