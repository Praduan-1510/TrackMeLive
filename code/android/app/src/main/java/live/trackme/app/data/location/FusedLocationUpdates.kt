package live.trackme.app.data.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * [LocationUpdates] from Google Play services' fused location provider. On the emulator, a route fed
 * with `adb emu geo fix` arrives here like real GPS.
 */
class FusedLocationUpdates(context: Context) : LocationUpdates {
    private val appContext = context.applicationContext
    private val client = LocationServices.getFusedLocationProviderClient(appContext)

    // The permission is checked just above the request; a SecurityException (taken away in between) is caught.
    @SuppressLint("MissingPermission")
    override fun fixes(request: FixRequest): Flow<LocationFix> = callbackFlow {
        if (!hasLocationPermission(appContext)) {
            close(LocationPermissionMissing())
            return@callbackFlow
        }
        val locationRequest = LocationRequest.Builder(
            if (request.highAccuracy) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            request.intervalMillis,
        )
            // No faster than asked: the writer would only drop the extras.
            .setMinUpdateIntervalMillis(request.intervalMillis)
            .setWaitForAccurateLocation(false)
            .build()
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.locations.forEach { trySend(it.toFix()) }
            }
        }
        try {
            client.requestLocationUpdates(locationRequest, callback, Looper.getMainLooper()).await()
        } catch (e: CancellationException) {
            client.removeLocationUpdates(callback)
            throw e
        } catch (e: SecurityException) {
            close(LocationPermissionMissing(e))
            return@callbackFlow
        }
        awaitClose { client.removeLocationUpdates(callback) }
    }

    companion object {
        fun hasLocationPermission(context: Context): Boolean =
            listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION).any {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }
    }
}

internal fun Location.toFix() = LocationFix(
    lat = latitude,
    lng = longitude,
    // A fix without an accuracy is treated as a poor one (it never counts as a GPS signal).
    accuracyM = if (hasAccuracy()) accuracy.toDouble() else UNKNOWN_ACCURACY_M,
    elapsedMillis = elapsedRealtimeNanos / 1_000_000,
    speedMps = if (hasSpeed()) speed.toDouble() else null,
)

private const val UNKNOWN_ACCURACY_M = 1_000.0
