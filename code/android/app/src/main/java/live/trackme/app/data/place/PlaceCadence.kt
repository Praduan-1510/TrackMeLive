package live.trackme.app.data.place

import live.trackme.app.domain.PingCadence
import live.trackme.schema.Precision
import live.trackme.schema.TmlSchemaConstants

/**
 * When to look a point up (x-decisions Q-PLACE): at most once per [minMillis], and only once the point
 * is at least [minMeters] from the one last answered; the first point, and the first at a new
 * precision, at once. A failed lookup leaves the last answered point where it was, so it's tried again
 * after the gap; a "nothing here" answer counts as answered. Times are monotonic milliseconds.
 */
class PlaceCadence(
    private val minMillis: Long = TmlSchemaConstants.PLACE_LOOKUP_MIN_SECONDS * 1000L,
    private val minMeters: Double = TmlSchemaConstants.PLACE_LOOKUP_MIN_METERS.toDouble(),
) {
    private var lastStartAt: Long? = null

    /** The precision of the last lookup started: a different one looks up at once. */
    var lastPrecision: Precision? = null
        private set
    private var answered: Pair<Double, Double>? = null

    fun isDue(lat: Double, lng: Double, precision: Precision, nowMillis: Long): Boolean {
        val startedAt = lastStartAt ?: return true
        if (precision != lastPrecision) return true
        if (nowMillis - startedAt < minMillis) return false
        val from = answered ?: return true
        return PingCadence.distanceMeters(from.first, from.second, lat, lng) >= minMeters
    }

    fun started(precision: Precision, nowMillis: Long) {
        lastStartAt = nowMillis
        lastPrecision = precision
    }

    /** The geocoder answered for this point, with a place or with nothing. */
    fun answered(lat: Double, lng: Double) {
        answered = lat to lng
    }
}
