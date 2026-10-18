package live.trackme.app.domain

import androidx.test.ext.junit.runners.AndroidJUnit4
import live.trackme.app.NameProblem
import live.trackme.app.Names
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** The shared name rule (schema.json › PersonName). Robolectric, for android.icu's BreakIterator. */
@RunWith(AndroidJUnit4::class)
class NamesTest {

    @Test
    fun countsWhatPeopleSeeNotCodeUnits() {
        assertEquals(1, Names.graphemeCount("👩🏽\u200D💻")) // ZWJ sequence with a skin tone: 7 code units
        assertEquals(1, Names.graphemeCount("e\u0301")) // e + combining acute
        assertEquals(1, Names.graphemeCount("🇮🇳")) // a flag is two regional indicators
        assertEquals(4, Names.graphemeCount("Alex"))
        assertEquals(2, Names.graphemeCount("नम")) // Devanagari
        assertEquals(0, Names.graphemeCount(""))
    }

    @Test
    fun oneToTwentyFourGraphemesAfterTrimming() {
        assertEquals(NameProblem.Empty, Names.problem("   "))
        assertNull(Names.problem("A"))
        assertNull(Names.problem("  Alex  "))
        assertNull(Names.problem("a".repeat(24)))
        assertEquals(NameProblem.TooLong, Names.problem("a".repeat(25)))
        assertNull(Names.problem("👩🏽\u200D💻".repeat(24)))
        assertEquals(NameProblem.TooLong, Names.problem("👩🏽\u200D💻".repeat(25)))
    }

    @Test
    fun needsALetterNumberSymbolOrEmoji() {
        assertEquals(NameProblem.NoLetters, Names.problem("..."))
        assertEquals(NameProblem.NoLetters, Names.problem("- -"))
        assertNull(Names.problem("7"))
        assertNull(Names.problem("☀"))
        assertNull(Names.problem("🦊"))
        assertNull(Names.problem("Zoë"))
    }

    @Test
    fun refusesControlAndBidiCharacters() {
        assertEquals(NameProblem.NoLetters, Names.problem("Al\u0000ex"))
        assertEquals(NameProblem.NoLetters, Names.problem("Alex\u202E"))
        assertEquals(NameProblem.NoLetters, Names.problem("\u2066Alex\u2069"))
        assertFalse(Names.isValid("Al\tex"))
    }

    @Test
    fun trimsLikeJavaScript() {
        assertEquals("Alex", Names.trim("\u00A0\uFEFF Alex \u2003"))
    }

    @Test
    fun tidyCollapsesWhitespace() {
        assertEquals("Mary Jane", Names.tidy("  Mary \u00A0  Jane "))
    }

    @Test
    fun typingStopsAtTwentyFour() {
        val full = "a".repeat(24)
        assertEquals(full, Names.limitInput(full))
        assertEquals(full, Names.limitInput(full + "b"))
        // A long paste keeps its first 24 graphemes, whole emoji included.
        assertEquals("👩🏽\u200D💻".repeat(24), Names.limitInput("👩🏽\u200D💻".repeat(30)))
        assertTrue(Names.graphemeCount(Names.limitInput("x".repeat(100))) == 24)
    }

    @Test
    fun inputDropsControlsAndTurnsBreaksIntoSpaces() {
        assertEquals("Ann Lee", Names.limitInput("Ann\nLee"))
        assertEquals("Alex", Names.limitInput("\u202EAl\u0007ex"))
    }
}
