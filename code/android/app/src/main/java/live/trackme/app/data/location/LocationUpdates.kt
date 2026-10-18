package live.trackme.app.data.location

import kotlinx.coroutines.flow.Flow

/** One location fix, from the fused location provider (or a fake in tests). */
data class LocationFix(
    /** Latitude, WGS 84 degrees. */
    val lat: Double,
    /** Longitude, WGS 84 degrees. */
    val lng: Double,
    /** Horizontal accuracy in meters, as the platform reports it. */
    val accuracyM: Double,
    /**
     * When the fix was taken, on the monotonic clock (`Location.elapsedRealtimeNanos` in ms). Pings turn it
     * into server time (`ServerClock`), so a phone whose wall clock is wrong still writes the right
     * `recorded_at`.
     */
    val elapsedMillis: Long,
    /** Ground speed in m/s, or null when the provider doesn't know it. */
    val speedMps: Double? = null,
)

/** How often to ask for fixes. Changing it means collecting [LocationUpdates.fixes] again. */
data class FixRequest(
    /** The interval the provider aims for, in ms. */
    val intervalMillis: Long,
    /** High accuracy (GPS) rather than balanced power (Wi-Fi and cell). */
    val highAccuracy: Boolean = true,
)

/**
 * Location fixes while collected (FSD §7). Cold: collecting starts updates, cancelling stops them, so
 * nothing listens to location while nobody shares.
 *
 * It needs the location permission (While using the app or Only this time; never Allow all the time,
 * FSD §8). While sharing it runs inside the location foreground service, which keeps While-using access
 * going in the background. Without the permission the flow fails with [LocationPermissionMissing].
 * With the system Location switch off it simply delivers nothing, which reads as "No GPS signal".
 */
interface LocationUpdates {
    fun fixes(request: FixRequest): Flow<LocationFix>
}

/** The location permission isn't granted (it was never given, or was taken away mid-share). */
class LocationPermissionMissing(cause: Throwable? = null) : Exception("Location permission missing", cause)
