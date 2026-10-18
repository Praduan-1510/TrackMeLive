package live.trackme.app.domain

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import live.trackme.schema.Precision
import live.trackme.schema.TmlSchemaConstants

/** The battery as the cadence needs it: the level in percent, or null when the phone doesn't say. */
data class BatteryReading(val percent: Int?)

/**
 * How often to write a ping (FSD §4 Battery-aware pings, §7): every 3 to 5 s above 20% battery, every
 * 15 s from 20% to 10%, every 60 s under 10%, and never less than once a minute.
 *
 * Within 3 to 5 s, movement and accuracy decide: 3 s while moving with a usable fix (better than 100 m),
 * 5 s when still, when the fix is poor (a faster ping wouldn't say anything new), or while Approximate
 * (the point is rounded to about 500 m, so it rarely changes). An unknown battery level counts as above
 * 20%. Charging doesn't change the steps: the FSD sets them by level alone.
 */
object PingCadence {
    const val MOVING_SECONDS = 3.0
    const val STILL_SECONDS = 5.0

    /** Walking pace starts around 1.2 m/s; under 1 m/s the person is standing or drifting with GPS noise. */
    const val MOVING_SPEED_MPS = 1.0

    /** The interval in seconds. [moving] and [accuracyM] come from the newest fix (null before the first). */
    fun intervalSeconds(battery: BatteryReading, moving: Boolean, accuracyM: Double?, precision: Precision): Double {
        val percent = battery.percent
        return when {
            percent != null && percent < TmlSchemaConstants.CRITICAL_BATTERY_PERCENT ->
                TmlSchemaConstants.PING_INTERVAL_CRITICAL_BATTERY_SECONDS.toDouble()
            percent != null && percent <= TmlSchemaConstants.LOW_BATTERY_PERCENT ->
                TmlSchemaConstants.PING_INTERVAL_LOW_BATTERY_SECONDS.toDouble()
            precision == Precision.APPROXIMATE -> STILL_SECONDS
            accuracyM == null || accuracyM >= TmlSchemaConstants.NO_FIX_ACCURACY_METERS -> STILL_SECONDS
            moving -> MOVING_SECONDS
            else -> STILL_SECONDS
        }
    }

    /**
     * How often to ask the location provider for a fix: the fastest interval of the battery step, so
     * moving between 3 and 5 s doesn't restart location updates; the writer spaces the pings.
     */
    fun fixIntervalSeconds(battery: BatteryReading): Double =
        intervalSeconds(battery, moving = true, accuracyM = 0.0, precision = Precision.PRECISE)

    /**
     * Whether the person is moving between two fixes: the provider's speed when it gives one; otherwise
     * the distance over the time between them, counted only when it's more than both fixes' accuracy (so
     * GPS wander doesn't read as walking).
     */
    fun isMoving(
        speedMps: Double?,
        previous: Pair<Double, Double>?,
        current: Pair<Double, Double>,
        secondsBetween: Double,
        accuracyM: Double,
        previousAccuracyM: Double?,
    ): Boolean {
        if (speedMps != null) return speedMps >= MOVING_SPEED_MPS
        if (previous == null || secondsBetween <= 0) return false
        val meters = distanceMeters(previous.first, previous.second, current.first, current.second)
        if (meters <= maxOf(accuracyM, previousAccuracyM ?: 0.0)) return false
        return meters / secondsBetween >= MOVING_SPEED_MPS
    }

    /** Great-circle distance in meters (haversine, mean Earth radius). */
    fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * EARTH_RADIUS_M * asin(sqrt(a.coerceIn(0.0, 1.0)))
    }

    private const val EARTH_RADIUS_M = 6_371_008.8
}
