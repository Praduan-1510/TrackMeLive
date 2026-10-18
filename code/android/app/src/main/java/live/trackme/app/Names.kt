package live.trackme.app

import android.icu.text.BreakIterator

/** Why a name can't be used. */
enum class NameProblem {
    /** Nothing but spaces. */
    Empty,

    /** More than 24 characters. Typing stops at 24, so this only comes from elsewhere. */
    TooLong,

    /** No letter, number, symbol or emoji, or a control or bidi-override character. */
    NoLetters,
}

/**
 * Names (the sign-up name and "Who it's for") are 1 to 24 grapheme clusters after trimming: the
 * characters a person sees, so an emoji sequence like 👩🏽 + U+200D (ZWJ) + 💻, or "é" written as
 * e + combining accent, counts as one. Never use String.length. They hold at least one letter,
 * number, symbol or emoji, and no control characters or bidi overrides and isolates (U+202A–U+202E,
 * U+2066–U+2069). The same rule as iOS, the viewer and the server (schema.json › PersonName;
 * x-decisions Q-NAME-LENGTH, Q-NAME-CHARACTERS), so the server never refuses a name the app let
 * someone type.
 */
object Names {
    const val MAX_GRAPHEMES = live.trackme.schema.TmlSchemaConstants.NAME_MAX_LENGTH

    fun graphemeCount(text: String): Int {
        if (text.isEmpty()) return 0
        val boundaries = BreakIterator.getCharacterInstance()
        boundaries.setText(text)
        var count = 0
        while (boundaries.next() != BreakIterator.DONE) count++
        return count
    }

    /** Trims the ends as JavaScript's trim() does, so the app and the server agree on what's left. */
    fun trim(raw: String): String = raw.trim { it.isWhitespace() || it == BYTE_ORDER_MARK }

    /** What's wrong with [raw], or null when it can be used. */
    fun problem(raw: String): NameProblem? {
        val name = trim(raw)
        return when {
            name.isEmpty() -> NameProblem.Empty
            graphemeCount(name) > MAX_GRAPHEMES -> NameProblem.TooLong
            FORBIDDEN.containsMatchIn(name) || !MEANINGFUL.containsMatchIn(name) -> NameProblem.NoLetters
            else -> null
        }
    }

    fun isValid(raw: String): Boolean = problem(raw) == null

    /** The name as stored: runs of whitespace become one space, and the ends are trimmed. */
    fun tidy(raw: String): String = trim(raw.replace(WHITESPACE, " "))

    /**
     * What the field keeps while someone types or pastes: line breaks and tabs become spaces, other
     * control and bidi-override characters are dropped, and typing stops at 24 graphemes (leading
     * spaces aside); a longer paste keeps its first 24.
     */
    fun limitInput(raw: String): String {
        val clean = raw.replace(LINE_BREAKS, " ").replace(FORBIDDEN, "")
        val text = clean.trimStart()
        if (graphemeCount(text) <= MAX_GRAPHEMES) return clean
        val boundaries = BreakIterator.getCharacterInstance()
        boundaries.setText(text)
        var end = 0
        repeat(MAX_GRAPHEMES) { end = boundaries.next() }
        return text.substring(0, end)
    }

    private const val BYTE_ORDER_MARK = '\uFEFF'

    // Unicode whitespace too (no-break and em spaces, line and paragraph separators), as the server's
    // trim() treats it. \p{Z} spells it out: \s alone is ASCII-only on the JVM, and Android's ICU
    // regex has no (?U) flag.
    private val WHITESPACE = Regex("[\\s\\p{Z}]+")
    private val LINE_BREAKS = Regex("[\\t\\n\\r]")
    private val FORBIDDEN = Regex("[\\p{Cc}\\u202A-\\u202E\\u2066-\\u2069]")
    private val MEANINGFUL = Regex("[\\p{L}\\p{N}\\p{S}]")
}
