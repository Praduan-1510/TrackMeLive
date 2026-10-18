package live.trackme.app.ui.signup

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

/**
 * Draws the typed digits formatted for the chosen country, "(415) 555-0142", while the field's value
 * stays plain digits. [format] is the country's as-you-type formatter (PhoneNumbers.formatAsYouType).
 * The cursor maps digit by digit; if the formatter's digits ever differ from the typed ones, the text
 * shows unformatted rather than with a wrong cursor.
 */
class PhoneNumberTransformation(private val format: (String) -> String) : VisualTransformation {

    override fun filter(text: AnnotatedString): TransformedText {
        val raw = text.text
        val formatted = format(raw)
        val mapping = DigitMapping.of(raw, formatted) ?: return TransformedText(text, OffsetMapping.Identity)
        return TransformedText(AnnotatedString(formatted), mapping)
    }

    override fun equals(other: Any?): Boolean = other is PhoneNumberTransformation && other.format == format

    override fun hashCode(): Int = format.hashCode()
}

/** Maps cursor positions between the raw text and its formatted form, which only adds characters. */
internal class DigitMapping private constructor(
    /** For each raw offset 0..raw.length, the formatted offset. */
    private val toFormatted: IntArray,
    private val formattedLength: Int,
) : OffsetMapping {

    override fun originalToTransformed(offset: Int): Int = toFormatted[offset.coerceIn(0, toFormatted.size - 1)]

    override fun transformedToOriginal(offset: Int): Int {
        val t = offset.coerceIn(0, formattedLength)
        // The raw offset whose formatted position is the last at or before t.
        var raw = 0
        while (raw + 1 < toFormatted.size && toFormatted[raw + 1] <= t) raw++
        return raw
    }

    companion object {
        /** Null when [formatted] isn't [raw] with characters added. */
        fun of(raw: String, formatted: String): DigitMapping? {
            val map = IntArray(raw.length + 1)
            var f = 0
            raw.forEachIndexed { i, ch ->
                while (f < formatted.length && formatted[f] != ch) {
                    if (formatted[f].isDigit() || formatted[f] == '+') return null
                    f++
                }
                if (f == formatted.length) return null
                f++
                map[i + 1] = f
            }
            // Anything left after the last digit must be formatting, not digits.
            if (formatted.substring(f).any { it.isDigit() }) return null
            return DigitMapping(map, formatted.length)
        }
    }
}
