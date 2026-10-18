package live.trackme.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import live.trackme.app.domain.PhoneCheck
import live.trackme.app.domain.PhoneInput
import live.trackme.app.domain.PhoneNumbers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The name and number rules on a real Android runtime. JVM unit tests use the JDK's regex and ICU;
 * the phone uses Android's own (ICU4C-backed regex, android.icu), which differ in places, so the rules
 * are checked here too. Needs no Firebase.
 */
@RunWith(AndroidJUnit4::class)
class OnDeviceRulesTest {
    @Test
    fun namesFollowTheSharedRule() {
        assertEquals(1, Names.graphemeCount("👩🏽\u200D💻"))
        assertEquals("Mary Jane", Names.tidy("  Mary \u00A0\u2003 Jane\u2028"))
        assertEquals("Ann Lee", Names.limitInput("Ann\nLee"))
        assertEquals("Alex", Names.limitInput("\u202EAl\u0007ex"))
        assertEquals("a".repeat(24), Names.limitInput("a".repeat(30)))
        assertNull(Names.problem("Zoë"))
        assertEquals(NameProblem.NoLetters, Names.problem("..."))
        assertEquals(NameProblem.Empty, Names.problem(" \u00A0 "))
    }

    @Test
    fun numbersBecomeE164() {
        val numbers = PhoneNumbers()
        assertEquals("+14155550142", (numbers.check(PhoneInput("US", "4155550142")) as PhoneCheck.Valid).e164)
        assertEquals(PhoneInput("GB", "7400123456"), numbers.input(PhoneInput("US", ""), "+44 7400 123456"))
        assertEquals("(415) 555-0142", numbers.formatAsYouType("US", "4155550142"))
        assertEquals(listOf("CI"), numbers.filter(numbers.countries(java.util.Locale.US), "cote d").map { it.region })
    }
}
