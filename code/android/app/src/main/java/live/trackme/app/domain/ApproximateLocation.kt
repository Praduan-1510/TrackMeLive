package live.trackme.app.domain

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.roundToLong
import live.trackme.schema.TmlSchemaConstants

/**
 * Approximate location (FSD §4 Location detail): each point is rounded to about 500 m on the phone,
 * before it's written, so neither the viewer nor the server ever sees the real one.
 *
 * Points snap to the centre of a fixed grid of cells about 500 m on a side: latitude in steps of 500 m,
 * longitude in steps that are 500 m wide at the snapped latitude. A fixed grid (rather than rounding
 * around each point) means standing still gives the same point every time, and the rounded point is at
 * most about 350 m (half a cell's diagonal) from the real one. accuracy_m is then at least 500, to
 * match (the rules refuse less while Approximate).
 */
object ApproximateLocation {
    private const val METERS_PER_DEGREE = 111_320.0
    private val CELL_METERS = TmlSchemaConstants.APPROXIMATE_ROUNDING_METERS.toDouble()

    data class Point(val lat: Double, val lng: Double)

    fun round(lat: Double, lng: Double): Point {
        val latStep = CELL_METERS / METERS_PER_DEGREE
        val roundedLat = snap(lat, latStep).coerceIn(-90.0, 90.0)
        // Near the poles a 500 m step spans many degrees; never more than the whole circle.
        val metersPerLngDegree = METERS_PER_DEGREE * cos(Math.toRadians(roundedLat))
        val lngStep = if (metersPerLngDegree * 360.0 <= CELL_METERS) 360.0 else CELL_METERS / metersPerLngDegree
        return Point(roundedLat, wrapLongitude(snap(lng, lngStep)))
    }

    /** The accuracy to write while Approximate: the fix's own, or 500 m when that's better. */
    fun accuracy(rawAccuracyM: Double): Double = maxOf(rawAccuracyM, CELL_METERS)

    private fun snap(value: Double, step: Double): Double = (value / step).roundToLong() * step

    private fun wrapLongitude(lng: Double): Double {
        if (lng in -180.0..180.0) return lng
        return lng - 360.0 * floor((lng + 180.0) / 360.0)
    }
}
