package live.trackme.app.domain

import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil
import com.google.i18n.phonenumbers.PhoneNumberUtil.PhoneNumberFormat
import com.google.i18n.phonenumbers.Phonenumber.PhoneNumber
import java.text.Collator
import java.text.Normalizer
import java.util.Locale

/** A country in the picker: its region code (ISO 3166, "US"), calling code (1) and name in the reader's language. */
data class Country(val region: String, val callingCode: Int, val name: String)

/** The result of checking a typed number. */
sealed interface PhoneCheck {
    data object Empty : PhoneCheck

    data object Invalid : PhoneCheck

    /** A valid number: [e164] goes to Firebase ("+14155550142"); [international] is for display ("+1 415-555-0142"). */
    data class Valid(val e164: String, val international: String) : PhoneCheck
}

/**
 * What the number field holds: a region and the digits typed, national format. A pasted or autofilled
 * "+44 7700 900123" moves to that country and keeps the national digits.
 */
data class PhoneInput(val region: String, val digits: String)

/**
 * Mobile numbers, with Google's libphonenumber metadata: validity per country, E.164 for Firebase
 * Authentication (FSD §8 Phone number), formatting as you type and each country's example number.
 */
class PhoneNumbers(private val util: PhoneNumberUtil = PhoneNumberUtil.getInstance()) {

    /** Every country libphonenumber knows, sorted by name in [locale]. */
    fun countries(locale: Locale = Locale.getDefault()): List<Country> {
        val collator = Collator.getInstance(locale)
        return util.supportedRegions.map { country(it, locale) }.sortedWith(compareBy(collator) { it.name })
    }

    fun country(region: String, locale: Locale = Locale.getDefault()): Country = Country(
        region = region,
        callingCode = util.getCountryCodeForRegion(region),
        name = Locale.Builder().setRegion(region).build().getDisplayCountry(locale).ifBlank { region },
    )

    /**
     * Applies an edit of the number field. Digits stay digits (formatting is only drawn, never stored).
     * A leading + reads the text as an international number: once its country code is clear, the field
     * moves to that country and keeps the national digits; until then the + and digits stay as typed.
     */
    fun input(current: PhoneInput, typed: String): PhoneInput {
        val digits = typed.filter { it in '0'..'9' }.take(MAX_DIGITS)
        if (!typed.trimStart().startsWith("+")) return current.copy(digits = digits)
        val number = parseOrNull("+$digits", UNKNOWN_REGION)
        val region = number?.let { util.getRegionCodeForNumber(it) ?: util.getRegionCodeForCountryCode(it.countryCode) }
        return if (number != null && region != null && region != UNKNOWN_REGION) {
            PhoneInput(region, util.getNationalSignificantNumber(number).take(MAX_DIGITS))
        } else {
            current.copy(digits = "+$digits")
        }
    }

    /**
     * Whether [input] is a whole, valid number. Validity is per calling code, so a Canadian number typed
     * with US +1 selected still counts: both are +1, and E.164 is the same either way.
     */
    fun check(input: PhoneInput): PhoneCheck {
        if (input.digits.isEmpty() || input.digits == "+") return PhoneCheck.Empty
        val number = parseOrNull(input.digits, input.region) ?: return PhoneCheck.Invalid
        if (!util.isValidNumber(number)) return PhoneCheck.Invalid
        return PhoneCheck.Valid(
            e164 = util.format(number, PhoneNumberFormat.E164),
            international = util.format(number, PhoneNumberFormat.INTERNATIONAL),
        )
    }

    /** [digits] formatted for [region] as far as they go: "415555" reads "(415) 555". */
    fun formatAsYouType(region: String, digits: String): String {
        if (digits.isEmpty()) return ""
        val formatter = util.getAsYouTypeFormatter(region)
        var out = ""
        digits.forEach { out = formatter.inputDigit(it) }
        return out
    }

    /** The countries whose name, region code or calling code matches [query] (accents and case ignored). */
    fun filter(countries: List<Country>, query: String): List<Country> {
        val q = fold(query.trim().removePrefix("+"))
        if (q.isEmpty()) return countries
        return countries.filter { c ->
            fold(c.name).contains(q) || c.region.equals(q, ignoreCase = true) || c.callingCode.toString().startsWith(q)
        }
    }

    private fun fold(text: String): String =
        Normalizer.normalize(text, Normalizer.Form.NFD).replace(MARKS, "").lowercase(Locale.ROOT)

    /** The country's example mobile number, national format, for "Enter your full mobile number, like …". */
    fun exampleNumber(region: String): String? =
        util.getExampleNumberForType(region, PhoneNumberUtil.PhoneNumberType.MOBILE)
            ?.let { util.format(it, PhoneNumberFormat.NATIONAL) }

    private fun parseOrNull(text: String, region: String): PhoneNumber? = try {
        util.parse(text, region)
    } catch (_: NumberParseException) {
        null
    }

    companion object {
        /** E.164 allows 15 digits; national input can carry a trunk prefix (0) and a little more. */
        const val MAX_DIGITS = 17
        const val FALLBACK_REGION = "US"
        private const val UNKNOWN_REGION = "ZZ"
        private val MARKS = Regex("\\p{Mn}+")

        /** The first known region among the SIM's, the network's and the locale's; US if none. */
        fun pickRegion(vararg candidates: String?): String {
            val supported = PhoneNumberUtil.getInstance().supportedRegions
            return candidates.asSequence()
                .mapNotNull { it?.trim()?.uppercase(Locale.ROOT)?.takeIf(String::isNotEmpty) }
                .firstOrNull { it in supported }
                ?: FALLBACK_REGION
        }
    }
}
