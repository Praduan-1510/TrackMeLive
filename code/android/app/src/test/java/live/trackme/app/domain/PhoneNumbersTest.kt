package live.trackme.app.domain

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** E.164 and country handling, on Google's libphonenumber metadata. Plain JVM. */
class PhoneNumbersTest {
    private val numbers = PhoneNumbers()

    @Test
    fun validUsNumberBecomesE164() {
        val check = numbers.check(PhoneInput("US", "4155550142"))
        assertEquals(PhoneCheck.Valid(e164 = "+14155550142", international = "+1 415-555-0142"), check)
    }

    @Test
    fun shortOrEmptyNumbersAreNotValid() {
        assertEquals(PhoneCheck.Empty, numbers.check(PhoneInput("US", "")))
        assertEquals(PhoneCheck.Invalid, numbers.check(PhoneInput("US", "41555501")))
        assertEquals(PhoneCheck.Invalid, numbers.check(PhoneInput("US", "0005550142")))
    }

    @Test
    fun nationalTrunkPrefixIsUnderstood() {
        val check = numbers.check(PhoneInput("GB", "07400123456"))
        assertEquals("+447400123456", (check as PhoneCheck.Valid).e164)
        assertEquals("+91 98765 43210", (numbers.check(PhoneInput("IN", "9876543210")) as PhoneCheck.Valid).international)
    }

    @Test
    fun aNumberFromAnotherPlusOneCountryStillCounts() {
        // Toronto, typed with US +1 selected: both are +1, and E.164 is the same.
        assertEquals("+14165550199", (numbers.check(PhoneInput("US", "4165550199")) as PhoneCheck.Valid).e164)
    }

    @Test
    fun digitsOnlyAndAtMostSeventeen() {
        val us = PhoneInput("US", "")
        assertEquals(PhoneInput("US", "4155550142"), numbers.input(us, "(415) 555-0142"))
        assertEquals(17, numbers.input(us, "1".repeat(40)).digits.length)
    }

    @Test
    fun pastedInternationalNumberPicksItsCountry() {
        assertEquals(PhoneInput("GB", "7700900123"), numbers.input(PhoneInput("US", ""), "+44 7700 900123"))
        assertEquals(PhoneInput("CA", "4165550199"), numbers.input(PhoneInput("US", ""), "+1 416-555-0199"))
    }

    @Test
    fun aHalfTypedInternationalNumberWaitsForItsCountryCode() {
        assertEquals(PhoneInput("US", "+"), numbers.input(PhoneInput("US", ""), "+"))
        assertEquals(PhoneInput("US", "+4"), numbers.input(PhoneInput("US", "+"), "+4"))
        assertEquals("GB", numbers.input(PhoneInput("US", "+44"), "+4477").region)
        assertEquals(PhoneCheck.Empty, numbers.check(PhoneInput("US", "+")))
    }

    @Test
    fun formatsAsYouType() {
        assertEquals("415-555", numbers.formatAsYouType("US", "415555"))
        assertEquals("(415) 555-0142", numbers.formatAsYouType("US", "4155550142"))
        assertEquals("07400 123456", numbers.formatAsYouType("GB", "07400123456"))
        assertEquals("", numbers.formatAsYouType("US", ""))
    }

    @Test
    fun exampleNumbersAreTheCountrysMobileExample() {
        assertEquals("(201) 555-0123", numbers.exampleNumber("US"))
        assertEquals("07400 123456", numbers.exampleNumber("GB"))
    }

    @Test
    fun defaultRegionFallsBackInOrder() {
        assertEquals("IN", PhoneNumbers.pickRegion("in", "us", "GB"))
        assertEquals("US", PhoneNumbers.pickRegion("", "us", "GB"))
        assertEquals("GB", PhoneNumbers.pickRegion(null, "  ", "GB"))
        assertEquals("US", PhoneNumbers.pickRegion(null, "xx", ""))
    }

    @Test
    fun countriesAreSortedAndSearchable() {
        val all = numbers.countries(Locale.US)
        assertTrue(all.size > 200)
        // Sorted the way people read names, accents included: Åland Islands sits between Afghanistan and Albania.
        val regions = all.map { it.region }
        assertEquals("AF", regions.first())
        assertTrue(regions.indexOf("AX") in (regions.indexOf("AF") + 1) until regions.indexOf("AL"))
        assertEquals(listOf("CI"), numbers.filter(all, "cote d").map { it.region }) // accents ignored: Côte d’Ivoire
        assertTrue(numbers.filter(all, "+44").any { it.region == "GB" })
        assertTrue(numbers.filter(all, "in").any { it.region == "IN" })
        assertEquals(all, numbers.filter(all, "  "))
        assertEquals(emptyList<Country>(), numbers.filter(all, "Atlantis"))
    }
}
