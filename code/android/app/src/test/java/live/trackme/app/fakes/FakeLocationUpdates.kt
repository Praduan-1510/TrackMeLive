package live.trackme.app.fakes

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import live.trackme.app.data.location.FixRequest
import live.trackme.app.data.location.LocationFix
import live.trackme.app.data.location.LocationPermissionMissing
import live.trackme.app.data.location.LocationUpdates

/**
 * [LocationUpdates] driven by the test: [send] delivers a fix to whoever is collecting. Records each
 * [FixRequest] (the cadence asked for) and whether anyone is listening.
 */
class FakeLocationUpdates : LocationUpdates {
    private val fixesChannel = Channel<LocationFix>(Channel.UNLIMITED)
    val requests = mutableListOf<FixRequest>()
    private val listening = MutableStateFlow(false)
    val isListening: StateFlow<Boolean> = listening.asStateFlow()

    /** When true, collecting fails as if the permission had been taken away. */
    var permissionMissing = false

    override fun fixes(request: FixRequest): Flow<LocationFix> = flow {
        if (permissionMissing) throw LocationPermissionMissing()
        requests += request
        listening.value = true
        try {
            for (fix in fixesChannel) emit(fix)
        } finally {
            listening.value = false
        }
    }

    fun send(fix: LocationFix) {
        fixesChannel.trySend(fix)
    }

    companion object {
        /** A fix at [elapsedMillis], 12 m accurate, still, near the prototype's harbor. */
        fun fix(
            elapsedMillis: Long,
            lat: Double = 37.8044,
            lng: Double = -122.2712,
            accuracyM: Double = 12.0,
            speedMps: Double? = 0.0,
        ) = LocationFix(lat = lat, lng = lng, accuracyM = accuracyM, elapsedMillis = elapsedMillis, speedMps = speedMps)
    }
}
