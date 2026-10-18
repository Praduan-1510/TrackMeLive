package live.trackme.app.data.place

import android.content.Context
import android.location.Geocoder
import android.os.Build
import androidx.annotation.RequiresApi
import java.io.IOException
import java.util.Locale
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asExecutor
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * [PlaceLookup] on the phone's own geocoder (android.location.Geocoder: free, no key; owner decision
 * Oct 19). On Android 13+ it uses the asynchronous getFromLocation with a listener; below that, the
 * blocking call on a background thread. No geocoder on the phone, or nothing at the point, is
 * [PlaceResult.NoPlace]; an error, or no answer within [timeoutMillis], is [PlaceResult.Failed].
 * A late answer after a timeout is dropped.
 */
class AndroidPlaceLookup(
    private val geocoder: Geocoding,
    private val executor: Executor = Dispatchers.IO.asExecutor(),
    private val timeoutMillis: Long = TIMEOUT_MS,
) : PlaceLookup {
    constructor(context: Context) : this(SystemGeocoding(context.applicationContext))

    override suspend fun lookUp(lat: Double, lng: Double): PlaceResult {
        if (!geocoder.isPresent()) return PlaceResult.NoPlace
        val answer = withTimeoutOrNull(timeoutMillis) {
            if (geocoder.sdkInt >= Build.VERSION_CODES.TIRAMISU) listen(lat, lng) else onBackgroundThread(lat, lng)
        } ?: return PlaceResult.Failed("no answer in $timeoutMillis ms")
        return answer.fold(
            onSuccess = { addresses ->
                addresses.firstNotNullOfOrNull(AddressNames::partsOf)?.let { PlaceResult.Found(it) } ?: PlaceResult.NoPlace
            },
            onFailure = { PlaceResult.Failed(it.message ?: it.javaClass.simpleName) },
        )
    }

    private suspend fun listen(lat: Double, lng: Double): Result<List<AddressFields>> =
        suspendCancellableCoroutine { cont ->
            try {
                geocoder.fromLocationAsync(
                    lat,
                    lng,
                    onAddresses = { if (cont.isActive) cont.resume(Result.success(it)) },
                    onError = { if (cont.isActive) cont.resume(Result.failure(IOException(it ?: "geocoder error"))) },
                )
            } catch (e: RuntimeException) {
                // A bad point (IllegalArgumentException) or a geocoder that throws instead of calling back.
                cont.resume(Result.failure(e))
            }
        }

    private suspend fun onBackgroundThread(lat: Double, lng: Double): Result<List<AddressFields>> =
        suspendCancellableCoroutine { cont ->
            executor.execute {
                // Anything the geocoder throws is a failed lookup, never a crash on this thread.
                val result = try {
                    Result.success(geocoder.fromLocationBlocking(lat, lng))
                } catch (e: IOException) {
                    Result.failure(e)
                } catch (e: RuntimeException) {
                    Result.failure(e)
                }
                if (cont.isActive) cont.resume(result)
            }
        }

    companion object {
        /** A lookup that hasn't answered by now is a failure; the next one tries again. */
        const val TIMEOUT_MS = 5_000L

        /** Only the best match is needed. */
        const val MAX_RESULTS = 1
    }
}

/**
 * The part of [Geocoder] the lookup uses, so both Android paths (and failures) can be tested without
 * a device. [SystemGeocoding] is the real one.
 */
interface Geocoding {
    /** Build.VERSION.SDK_INT on the phone. */
    val sdkInt: Int

    /** [Geocoder.isPresent]: false on phones without a geocoding backend. */
    fun isPresent(): Boolean

    /** Android 13+: the listener form. Exactly one callback is called, on any thread. */
    fun fromLocationAsync(lat: Double, lng: Double, onAddresses: (List<AddressFields>) -> Unit, onError: (String?) -> Unit)

    /** Below Android 13: the blocking form; call it off the main thread. Throws [IOException]. */
    fun fromLocationBlocking(lat: Double, lng: Double): List<AddressFields>
}

/** [Geocoding] on android.location.Geocoder, in the phone's language. */
class SystemGeocoding(private val context: Context) : Geocoding {
    override val sdkInt: Int get() = Build.VERSION.SDK_INT

    override fun isPresent(): Boolean = Geocoder.isPresent()

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    override fun fromLocationAsync(lat: Double, lng: Double, onAddresses: (List<AddressFields>) -> Unit, onError: (String?) -> Unit) {
        geocoder().getFromLocation(
            lat,
            lng,
            AndroidPlaceLookup.MAX_RESULTS,
            object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<android.location.Address>) = onAddresses(addresses.map(AddressFields::of))

                override fun onError(errorMessage: String?) = onError(errorMessage)
            },
        )
    }

    // The blocking form is deprecated from Android 13, where the listener form above is used instead.
    @Suppress("DEPRECATION")
    override fun fromLocationBlocking(lat: Double, lng: Double): List<AddressFields> =
        geocoder().getFromLocation(lat, lng, AndroidPlaceLookup.MAX_RESULTS).orEmpty().map(AddressFields::of)

    private fun geocoder() = Geocoder(context, Locale.getDefault())
}
