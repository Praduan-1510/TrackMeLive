package live.trackme.app

import android.icu.text.BreakIterator

/**
 * Names (the sign-up name and "Who it's for") are 1 to 24 grapheme clusters after trimming: the
 * characters a person sees, so "👩🏽‍💻" or "é" written as e + combining accent counts as one. Never use
 * String.length. Same rule as iOS String.count and the shared schema's validator.
 */
object Names {
    const val MAX_GRAPHEMES = 24

    fun graphemeCount(text: String): Int {
        if (text.isEmpty()) return 0
        val it = BreakIterator.getCharacterInstance()
        it.setText(text)
        var count = 0
        while (it.next() != BreakIterator.DONE) count++
        return count
    }

    fun isValid(raw: String): Boolean = graphemeCount(raw.trim()) in 1..MAX_GRAPHEMES
}
