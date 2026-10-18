package live.trackme.app.data.place

/** One reverse-geocoding answer. */
sealed interface PlaceResult {
    /** The point has a name: at least one of its parts. */
    data class Found(val parts: PlaceParts) : PlaceResult

    /** The geocoder answered, with nothing usable here, or this phone has no geocoder. */
    data object NoPlace : PlaceResult

    /** No answer: an error or a timeout. Worth asking again later. [reason] is for the log, without the point. */
    data class Failed(val reason: String) : PlaceResult
}

/**
 * Names a point (FSD §4 "Where Alex is", in words): the phone's own geocoder in the app
 * ([AndroidPlaceLookup]), a fake in tests. It never throws for a failed lookup; it answers
 * [PlaceResult.Failed]. When to ask, and what may be written while Approximate, is the ping
 * uploader's job.
 */
fun interface PlaceLookup {
    suspend fun lookUp(lat: Double, lng: Double): PlaceResult
}
