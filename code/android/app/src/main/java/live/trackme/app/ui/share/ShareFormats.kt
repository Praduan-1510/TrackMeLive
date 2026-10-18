package live.trackme.app.ui.share

import android.content.res.Resources
import android.icu.text.BreakIterator
import android.text.BidiFormatter
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneId
import live.trackme.app.Names
import live.trackme.app.R

/**
 * Times, durations and the viewer's name as every sharing screen writes them (prototype `fmt`,
 * `minutes`, `minutesSpoken`, `who`): "9:38 pm" on a 12-hour phone and "21:38" on a 24-hour one,
 * "< 1 min" and "5 min" to the eye and "less than a minute" and "5 minutes" to TalkBack.
 */
@Immutable
class ShareFormats(
    private val resources: Resources,
    private val is24Hour: Boolean,
    private val zone: ZoneId,
) {
    /** "9:38 pm" or "21:38", for a server time in epoch ms. */
    fun clock(epochMillis: Long): String {
        val t = Instant.ofEpochMilli(epochMillis).atZone(zone)
        val minutes = t.minute.toString().padStart(2, '0')
        if (is24Hour) return "${t.hour.toString().padStart(2, '0')}:$minutes"
        val hour = (t.hour % 12).let { if (it == 0) 12 else it }
        return resources.getString(if (t.hour < 12) R.string.time_am else R.string.time_pm, "$hour:$minutes")
    }

    /** "< 1 min" or "5 min": whole minutes, rounded down. */
    fun duration(millis: Long): String {
        val m = wholeMinutes(millis)
        return if (m < 1) resources.getString(R.string.duration_under_minute) else resources.getString(R.string.duration_minutes, m)
    }

    /** "less than a minute", "1 minute", "5 minutes". */
    fun durationSpoken(millis: Long): String {
        val m = wholeMinutes(millis)
        return if (m < 1) {
            resources.getString(R.string.duration_under_minute_spoken)
        } else {
            resources.getQuantityString(R.plurals.duration_minutes_spoken, m.toInt(), m)
        }
    }

    private fun wholeMinutes(millis: Long): Long = millis.coerceAtLeast(0) / 60_000L

    companion object {
        /** A ping interval as written: "3.5" or "5", never "5.0". */
        fun seconds(value: Double): String =
            BigDecimal.valueOf(value).setScale(1, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
    }
}

/** [ShareFormats] for this phone's resources, 12/24-hour setting and time zone. */
@Composable
fun rememberShareFormats(): ShareFormats {
    val context = LocalContext.current
    val resources = LocalResources.current
    val configuration = LocalConfiguration.current
    return remember(context, resources, configuration) {
        ShareFormats(resources, DateFormat.is24HourFormat(context), ZoneId.systemDefault())
    }
}

/**
 * "Who it's for" (FSD §4): the optional name of the person getting the link, used only on the sharer's
 * screens. Without one the copy says they and them, and the viewer's disc shows a person icon. The
 * copy never guesses a pronoun from a name.
 */
@Immutable
data class Audience(
    /** The tidied name, or null when none was given. */
    val name: String?,
) {
    /** The name direction-isolated for a sentence, so a right-to-left name never reorders it. */
    val inSentence: String? get() = name?.let { BidiFormatter.getInstance().unicodeWrap(it) }

    /** The viewer's disc: the name's first character, upper-cased, when it's a letter or a digit; otherwise null (a person icon). */
    val initial: String?
        get() {
            val n = name ?: return null
            val boundaries = BreakIterator.getCharacterInstance()
            boundaries.setText(n)
            val first = n.substring(0, boundaries.next())
            return first.takeIf { Character.isLetterOrDigit(it.codePointAt(0)) }?.uppercase()
        }

    companion object {
        val None = Audience(null)

        fun of(raw: String?): Audience = Audience(raw?.let(Names::tidy)?.takeIf { it.isNotEmpty() })
    }
}
