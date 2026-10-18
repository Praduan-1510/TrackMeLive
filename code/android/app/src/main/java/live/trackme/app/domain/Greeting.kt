package live.trackme.app.domain

import java.time.LocalTime

/** Home's kicker: Good morning, Good afternoon or Good evening, by the phone's local time. */
enum class Greeting {
    Morning,
    Afternoon,
    Evening,
    ;

    companion object {
        /** Morning from 5:00, afternoon from 12:00, evening from 18:00 (and through the night). */
        fun at(time: LocalTime): Greeting = when (time.hour) {
            in 5..11 -> Morning
            in 12..17 -> Afternoon
            else -> Evening
        }

        /** Milliseconds from [time] until the greeting next changes. */
        fun millisUntilNextChange(time: LocalTime): Long {
            val next = listOf(LocalTime.of(5, 0), LocalTime.NOON, LocalTime.of(18, 0)).firstOrNull { it.isAfter(time) }
            val untilNext = if (next != null) {
                java.time.Duration.between(time, next)
            } else {
                java.time.Duration.between(time, LocalTime.MAX).plusNanos(1).plusHours(5)
            }
            return untilNext.toMillis().coerceAtLeast(1)
        }
    }
}
