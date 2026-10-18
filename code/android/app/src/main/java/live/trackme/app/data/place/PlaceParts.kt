package live.trackme.app.data.place

import java.text.BreakIterator
import java.util.Locale
import live.trackme.schema.Precision
import live.trackme.schema.TmlSchemaConstants

/**
 * Where the sharer is, in words, for the viewer's "Where Alex is" line (FSD §4; x-decisions Q-PLACE): a
 * named place, the street, the area and the city, as the phone's own geocoder names them. Each part is
 * already clean ([PlaceText.clean]) and at least one is set; build one with [of].
 */
data class PlaceParts(
    /** A park, landmark or venue at the point, never a house number or a repeat of the street. */
    val name: String?,
    /** The thoroughfare, without a house number. */
    val street: String?,
    /** The neighbourhood (sub-locality). */
    val area: String?,
    /** The locality. */
    val city: String?,
) {
    init {
        require(name != null || street != null || area != null || city != null) { "a place has at least one part" }
    }

    /**
     * What may be written at [precision]: everything while Precise; only area and city while
     * Approximate, so the words never say more than the rounded point. Null when nothing is left.
     */
    fun forPrecision(precision: Precision): PlaceParts? = when (precision) {
        Precision.PRECISE -> this
        Precision.APPROXIMATE -> if (name == null && street == null) this else of(null, null, area, city)
    }

    companion object {
        /** Cleans each part ([PlaceText.clean]); null when none is left. */
        fun of(name: String?, street: String?, area: String?, city: String?): PlaceParts? {
            val n = PlaceText.clean(name)
            val s = PlaceText.clean(street)
            val a = PlaceText.clean(area)
            val c = PlaceText.clean(city)
            return if (n == null && s == null && a == null && c == null) null else PlaceParts(n, s, a, c)
        }
    }
}

/**
 * The rule every place part is written to (shared PlacePart; firestore.rules validPlacePart), so a ping
 * batch is never refused for its words.
 */
object PlaceText {
    /** At most this many UTF-16 code units (Kotlin's length, Firestore rules' size()). */
    const val MAX_LENGTH = TmlSchemaConstants.PLACE_PART_MAX_LENGTH

    /**
     * [raw] without control characters (Cc), bidi overrides and isolates (U+202A to U+202E, U+2066 to
     * U+2069) and unpaired surrogates, trimmed of Unicode whitespace, and cut at a character boundary to
     * [MAX_LENGTH]. Null when nothing is left.
     */
    fun clean(raw: String?): String? {
        if (raw == null) return null
        val kept = StringBuilder(raw.length)
        var i = 0
        while (i < raw.length) {
            val cp = raw.codePointAt(i)
            if (!isStripped(cp)) kept.appendCodePoint(cp)
            i += Character.charCount(cp)
        }
        return cut(kept.toString().trim()).trim().ifEmpty { null }
    }

    private fun isStripped(cp: Int): Boolean {
        val type = Character.getType(cp)
        return type == Character.CONTROL.toInt() ||
            type == Character.SURROGATE.toInt() ||
            cp in BIDI_OVERRIDES ||
            cp in BIDI_ISOLATES
    }

    /** The longest start of [text] that ends on a character (grapheme) boundary within [MAX_LENGTH]. */
    private fun cut(text: String): String {
        if (text.length <= MAX_LENGTH) return text
        val boundaries = BreakIterator.getCharacterInstance(Locale.ROOT).apply { setText(text) }
        var end = boundaries.preceding(MAX_LENGTH + 1)
        // Never inside a surrogate pair, whatever the break rules say.
        if (end > 0 && Character.isHighSurrogate(text[end - 1])) end--
        return text.substring(0, end.coerceAtLeast(0))
    }

    private val BIDI_OVERRIDES = 0x202A..0x202E
    private val BIDI_ISOLATES = 0x2066..0x2069
}
