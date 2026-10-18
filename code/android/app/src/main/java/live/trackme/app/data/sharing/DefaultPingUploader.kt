package live.trackme.app.data.sharing

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import live.trackme.app.data.location.FixRequest
import live.trackme.app.data.location.LocationFix
import live.trackme.app.data.location.LocationPermissionMissing
import live.trackme.app.data.location.LocationUpdates
import live.trackme.app.data.place.PlaceCadence
import live.trackme.app.data.place.PlaceLookup
import live.trackme.app.data.place.PlaceResult
import live.trackme.app.domain.ApproximateLocation
import live.trackme.app.domain.Clock
import live.trackme.app.domain.PingCadence
import live.trackme.app.domain.ServerClock
import live.trackme.schema.Precision
import live.trackme.schema.TmlSchemaConstants

/**
 * [PingUploader] on a [SessionDataSource] (see the interface for the rules it follows).
 *
 * One run has four parts: the location listener (re-asked whenever the cadence changes), the writer
 * (one batch in flight at a time, the newest fix wins), the place lookups, and the end watch, which
 * cancels them all the moment the session is over on the server's clock.
 *
 * The place ("Where Alex is", x-decisions Q-PLACE): each confirmed ping may start a lookup of its point
 * as written ([PlaceCadence]: at most once per 10 s, after moving 25 m, at once for a new precision).
 * A place that differs from what the session holds goes with the next write: the next ping's batch, or
 * a check-in right away, so it never waits a whole low-battery interval. A failed or empty lookup writes
 * nothing. Every write keeps the Approximate rule: name and street are dropped from what the session
 * holds before anything is written while Approximate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DefaultPingUploader(
    private val location: LocationUpdates,
    private val source: SessionDataSource,
    private val battery: BatteryMonitor,
    private val serverClock: ServerClock,
    private val clock: Clock,
    /** Names the points written, for the session's place. */
    private val places: PlaceLookup,
    /** Called with the server clock's offset whenever it gets better, to keep it for this boot. */
    private val onClockSynced: (Long) -> Unit = {},
) : PingUploader {
    private val mutableStatus = MutableStateFlow(UploadStatus.Initial)
    override val status: StateFlow<UploadStatus> = mutableStatus.asStateFlow()

    override suspend fun run(share: ActiveShare, session: StateFlow<SessionView?>) {
        try {
            // Nothing is written before the session doc is known: its precision decides how points are rounded.
            val first = session.filterNotNull().first()
            if (first.endAt(serverClock.syncedNowMillis()) != null) return
            mutableStatus.value = UploadStatus.Initial.copy(
                intervalSeconds = first.pingIntervalSeconds,
                precision = first.effectivePrecision,
            )
            coroutineScope {
                val run = Run(share.sessionId, session, first)
                launch { run.listen() }
                launch { session.collect { run.wake.trySend(Unit) } }
                launch { run.lookUpPlaces() }
                launch { run.write() }
                awaitEnd(session)
                coroutineContext.cancelChildren()
            }
        } finally {
            mutableStatus.value = UploadStatus.Initial
        }
    }

    /** Returns once the session is over: ended on the server, or past its stop_at or expires_at. */
    private suspend fun awaitEnd(session: StateFlow<SessionView?>) {
        while (true) {
            val current = session.value
            val now = serverClock.syncedNowMillis()
            if (current != null && current.endAt(now) != null) return
            val untilDue = when {
                current == null -> Long.MAX_VALUE
                // No server time yet: look again soon (the first check-in brings it).
                now == null -> UNSYNCED_CHECK_IN_MS
                else -> current.endsAtMillis - now
            }
            withTimeoutOrNull(untilDue.coerceAtLeast(1)) { session.first { it != current } }
        }
    }

    private inner class Run(private val sessionId: String, private val session: StateFlow<SessionView?>, private val initial: SessionView) {
        /** Something changed (a fix, the session): the writer looks again. */
        val wake = Channel<Unit>(Channel.CONFLATED)
        private val newestFix = MutableStateFlow<LocationFix?>(null)
        private val fixInterval = MutableStateFlow(initial.pingIntervalSeconds)
        private val startedAt = clock.elapsedMillis()
        private val placeCadence = PlaceCadence()
        private val placeRequests = Channel<PlaceRequest>(Channel.CONFLATED)

        /** The newest lookup's answer; the writer deals with it (and keeps [placeCadence]). */
        private val placeAnswer = MutableStateFlow<PlaceAnswer?>(null)

        /** Location fixes at the cadence in use; asked again whenever it changes. */
        suspend fun listen() {
            fixInterval.collectLatest { seconds ->
                try {
                    location.fixes(FixRequest(intervalMillis = (seconds * 1000).toLong())).collect {
                        newestFix.value = it
                        wake.trySend(Unit)
                    }
                } catch (e: LocationPermissionMissing) {
                    // Without location the share keeps checking in; the row says No GPS signal.
                    Log.w(TAG, "location permission missing while sharing", e)
                }
            }
        }

        /** Looks up each point the writer asks about; a newer request (a precision change) replaces one in flight. */
        suspend fun lookUpPlaces() {
            placeRequests.receiveAsFlow().collectLatest { request ->
                val result = try {
                    places.lookUp(request.lat, request.lng)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: RuntimeException) {
                    PlaceResult.Failed(e.javaClass.simpleName)
                }
                placeAnswer.value = PlaceAnswer(request, result)
                wake.trySend(Unit)
            }
        }

        suspend fun write() {
            // The newest fix already dealt with: written, or passed over as one the rules wouldn't take.
            var handled: LocationFix? = null
            var lastPingAt: Long? = null
            // recorded_at of the last ping this run wrote.
            var lastRecordedAt: Long? = null
            // Without server time yet (after a reboot) the first write is a check-in, to learn it.
            var lastCheckInAt = if (serverClock.synced) startedAt else startedAt - CHECK_IN_MS
            var previous: LocationFix? = null
            var moving = false
            var lastGoodFixAt: Long? = null
            var failures = 0
            var retryAt: Long? = null
            var writtenInterval = initial.pingIntervalSeconds
            // The place the session holds, as this run last wrote it or saw it change on the session doc.
            var heldPlace: SessionPlace? = initial.place
            var seenPlace: SessionPlace? = initial.place
            var handledAnswer: PlaceAnswer? = null
            // A looked-up place the session doesn't hold yet.
            var newPlace: FoundPlace? = null
            // The newest ping written, for the lookup a precision change makes at once.
            var lastWritten: PlaceRequest? = null

            while (true) {
                val current = session.value ?: initial
                // The end watch cancels this too; checking here means not even a write at the very moment it ends.
                if (current.endAt(serverClock.syncedNowMillis()) != null) return
                val now = clock.elapsedMillis()
                val fix = newestFix.value
                if (fix != null && fix !== previous) {
                    moving = PingCadence.isMoving(
                        speedMps = fix.speedMps,
                        previous = previous?.let { it.lat to it.lng },
                        current = fix.lat to fix.lng,
                        secondsBetween = previous?.let { (fix.elapsedMillis - it.elapsedMillis) / 1000.0 } ?: 0.0,
                        accuracyM = fix.accuracyM,
                        previousAccuracyM = previous?.accuracyM,
                    )
                    if (fix.accuracyM < TmlSchemaConstants.NO_FIX_ACCURACY_METERS) lastGoodFixAt = fix.elapsedMillis
                    previous = fix
                }
                val precision = current.effectivePrecision
                if (current.place != seenPlace) {
                    // Changed on the session doc (turning Approximate on drops the street there): that's what it holds.
                    seenPlace = current.place
                    heldPlace = current.place
                }
                placeAnswer.value?.takeIf { it !== handledAnswer }?.let { answer ->
                    handledAnswer = answer
                    onPlaceAnswer(answer)?.let { newPlace = it }
                }
                // A precision change looks up at once: the newest point written, rounded when it's now Approximate.
                // Back to Precise, the next (precise) ping does it.
                lastWritten?.takeIf { precision != placeCadence.lastPrecision }
                    ?.takeIf { precision == Precision.APPROXIMATE || it.precision == Precision.PRECISE }
                    ?.let { requestPlace(it.atPrecision(precision), now) }
                newPlace = newPlace?.takeIf { it.precision == precision && it.place.parts != heldPlace?.parts }
                val placeUpdate = newPlace?.let { PlaceUpdate.Set(it.place) } ?: heldPlace?.updateFor(precision)
                val interval = PingCadence.intervalSeconds(battery.reading(), moving, fix?.accuracyM, precision)
                fixInterval.value = interval
                mutableStatus.update {
                    it.copy(intervalSeconds = interval, precision = precision, signal = signalAt(now, lastGoodFixAt))
                }

                val fresh = fix?.takeIf { it !== handled && serverClock.synced }
                val candidate = fresh?.let { pingOf(it, precision) }
                    ?.takeIf { acceptable(it, current, lastRecordedAt) }
                // A fix the rules wouldn't take (too close to the last ping, too old, too vague) is dropped;
                // the next one will do.
                if (fresh != null && candidate == null) handled = fresh

                val waiting = retryAt != null && now < retryAt
                val pingSpacing = (interval * 1000).toLong() - EARLY_TOLERANCE_MS
                val pingDue = candidate != null && (lastPingAt == null || now - lastPingAt >= pingSpacing)
                val checkInEvery = if (serverClock.synced) CHECK_IN_MS else UNSYNCED_CHECK_IN_MS
                val checkInDue = now - lastCheckInAt >= checkInEvery
                // A new place doesn't wait for the next ping: a check-in takes it now.
                val placeDue = placeUpdate != null
                if (!waiting && (pingDue || checkInDue || placeDue)) {
                    val ping = candidate.takeIf { pingDue }
                    // With a ping, the place is that ping's: at is its recorded_at (firestore.rules validPlaceShape).
                    val place = if (ping != null && placeUpdate is PlaceUpdate.Set) {
                        PlaceUpdate.Set(placeUpdate.place.copy(atMillis = ping.recordedAtMillis))
                    } else {
                        placeUpdate
                    }
                    val checkIn = CheckInWrite(
                        pingIntervalSeconds = interval.takeIf { it != writtenInterval && it != current.pingIntervalSeconds },
                        applyPrecision = if (ping != null) current.precisionNext else null,
                        place = place,
                    )
                    if (ping != null) mutableStatus.update { it.copy(lastPoint = ping.toShared(precision)) }
                    val sentAt = clock.elapsedMillis()
                    if (send(ping, checkIn)) {
                        failures = 0
                        retryAt = null
                        lastCheckInAt = sentAt
                        if (place != null) {
                            heldPlace = (place as? PlaceUpdate.Set)?.place
                            newPlace = null
                        }
                        if (ping != null) {
                            handled = fix
                            lastPingAt = sentAt
                            lastRecordedAt = ping.recordedAtMillis
                            val written = PlaceRequest(ping.lat, ping.lng, precision, ping.recordedAtMillis)
                            lastWritten = written
                            requestPlace(written, clock.elapsedMillis())
                        }
                        writtenInterval = interval
                        syncClock(sentAt)
                    } else {
                        failures++
                        retryAt = clock.elapsedMillis() + retryDelayMillis(failures)
                    }
                    continue
                }

                val deadlines = listOfNotNull(
                    retryAt?.takeIf { waiting },
                    lastPingAt?.let { it + pingSpacing }?.takeIf { candidate != null },
                    lastCheckInAt + checkInEvery,
                    // The row turns to No GPS signal on time.
                    (lastGoodFixAt ?: startedAt) + NO_FIX_MS,
                ).filter { it > now }
                val next = deadlines.minOrNull() ?: (now + CHECK_IN_MS)
                withTimeoutOrNull(next - now) { wake.receive() }
            }
        }

        /** Asks for a lookup of [request] when the cadence allows one now. */
        private fun requestPlace(request: PlaceRequest, now: Long) {
            if (!placeCadence.isDue(request.lat, request.lng, request.precision, now)) return
            placeCadence.started(request.precision, now)
            placeRequests.trySend(request)
        }

        /** The place to write from a lookup's answer, if any. A failed or empty lookup writes nothing. */
        private fun onPlaceAnswer(answer: PlaceAnswer): FoundPlace? {
            val request = answer.request
            return when (val result = answer.result) {
                is PlaceResult.Found -> {
                    placeCadence.answered(request.lat, request.lng)
                    result.parts.forPrecision(request.precision)
                        ?.let { FoundPlace(SessionPlace(it, request.recordedAtMillis), request.precision) }
                }
                PlaceResult.NoPlace -> {
                    placeCadence.answered(request.lat, request.lng)
                    null
                }
                is PlaceResult.Failed -> {
                    // Never the point or the words: only why.
                    Log.w(TAG, "place lookup failed: ${result.reason}")
                    null
                }
            }
        }

        private fun signalAt(now: Long, lastGoodFixAt: Long?): GpsSignal = when {
            lastGoodFixAt != null && now - lastGoodFixAt < NO_FIX_MS -> GpsSignal.Ok
            lastGoodFixAt == null && now - startedAt < NO_FIX_MS -> GpsSignal.Searching
            else -> GpsSignal.NoSignal
        }

        private fun pingOf(fix: LocationFix, precision: Precision): PingWrite {
            val recordedAt = serverClock.millisAt(fix.elapsedMillis)
            return if (precision == Precision.APPROXIMATE) {
                val point = ApproximateLocation.round(fix.lat, fix.lng)
                PingWrite(point.lat, point.lng, ApproximateLocation.accuracy(fix.accuracyM), recordedAt)
            } else {
                PingWrite(fix.lat, fix.lng, fix.accuracyM, recordedAt)
            }
        }

        /**
         * The rules' limits on a ping (x-decisions Q-PING-WRITE): at least 2 s after the previous one
         * (this run's, or last_fix_at from before a restart), no more than 5 minutes before the session
         * started, not ahead of the server's clock by more than the allowed skew, and an accuracy under
         * 100 km.
         */
        private fun acceptable(ping: PingWrite, session: SessionView, lastRecordedAt: Long?): Boolean {
            val previousFix = listOfNotNull(lastRecordedAt, session.lastFixAtMillis).maxOrNull()
            return (previousFix == null || ping.recordedAtMillis >= previousFix + MIN_SPACING_MS) &&
                ping.recordedAtMillis >= session.startedAtMillis - FIRST_PING_WINDOW_MS &&
                ping.recordedAtMillis <= serverClock.nowMillis() + CLOCK_SKEW_MS &&
                ping.accuracyM <= TmlSchemaConstants.MAX_ACCURACY_METERS
        }

        /**
         * One batch, waited for until the server confirms it. Past [OFFLINE_AFTER_MS] the row says No
         * connection, and the writer keeps waiting rather than piling more writes into Firestore's queue.
         */
        private suspend fun send(ping: PingWrite?, checkIn: CheckInWrite): Boolean = coroutineScope {
            val write = async { attempt(ping, checkIn) }
            val quick = withTimeoutOrNull(OFFLINE_AFTER_MS) { write.await() }
            if (quick == null) mutableStatus.update { it.copy(offline = true) }
            val ok = quick ?: write.await()
            mutableStatus.update { it.copy(offline = !ok && it.offline) }
            ok
        }

        private suspend fun attempt(ping: PingWrite?, checkIn: CheckInWrite): Boolean = try {
            source.write(sessionId, ping, checkIn)
            true
        } catch (e: SharingDataException) {
            // A batch that landed but whose answer was lost is refused when sent again (its recorded_at is
            // no longer after last_fix_at): it's written, not an error.
            if (ping != null && e.reason == SharingFailure.NotSharing && landed(ping)) {
                true
            } else {
                Log.w(TAG, "ping write failed: ${e.reason}", e)
                false
            }
        }

        private suspend fun landed(ping: PingWrite): Boolean = try {
            val lastFix = source.serverMarks(sessionId).lastFixAtMillis
            lastFix != null && lastFix >= ping.recordedAtMillis
        } catch (e: SharingDataException) {
            Log.w(TAG, "session read failed: ${e.reason}", e)
            false
        }

        /** After a reboot there's no server time yet: read the check-in just written back from the server. */
        private suspend fun syncClock(sentAt: Long) {
            if (serverClock.synced) return
            try {
                serverClock.observe(source.serverMarks(sessionId).lastPingAtMillis, sentAt)
                serverClock.offsetMillis?.let(onClockSynced)
            } catch (e: CancellationException) {
                throw e
            } catch (e: SharingDataException) {
                Log.w(TAG, "server time read failed: ${e.reason}", e)
            }
        }
    }

    internal companion object {
        const val CHECK_IN_MS = TmlSchemaConstants.CHECK_IN_INTERVAL_SECONDS * 1000L
        const val NO_FIX_MS = TmlSchemaConstants.NO_FIX_TIMEOUT_SECONDS * 1000L

        /** A fix that arrives a little before its interval is up still counts. */
        const val EARLY_TOLERANCE_MS = 500L

        /** A write the server hasn't confirmed after this long means No connection. */
        const val OFFLINE_AFTER_MS = 10_000L

        /** Without server time, check in this often until a read-back gives it. */
        const val UNSYNCED_CHECK_IN_MS = 5_000L

        const val MIN_SPACING_MS = TmlSchemaConstants.MIN_PING_SPACING_SECONDS * 1000L
        const val CLOCK_SKEW_MS = TmlSchemaConstants.PING_CLOCK_SKEW_SECONDS * 1000L
        const val FIRST_PING_WINDOW_MS = TmlSchemaConstants.FIRST_PING_BEFORE_START_MINUTES * 60_000L

        /** After the nth failed write in a row: 2, 4, 8, 16, 32 s, then every 60 s. */
        fun retryDelayMillis(failures: Int): Long = if (failures >= 6) 60_000L else 1_000L shl failures.coerceAtLeast(1)
    }
}

private fun PingWrite.toShared(precision: Precision) = SharedPoint(lat, lng, accuracyM, recordedAtMillis, precision)

/** A point to name, as written (rounded while Approximate), with its ping's recorded_at. */
private data class PlaceRequest(val lat: Double, val lng: Double, val precision: Precision, val recordedAtMillis: Long) {
    /** The same point at [target] precision: rounded for Approximate. */
    fun atPrecision(target: Precision): PlaceRequest = if (target == Precision.APPROXIMATE && precision == Precision.PRECISE) {
        val point = ApproximateLocation.round(lat, lng)
        PlaceRequest(point.lat, point.lng, target, recordedAtMillis)
    } else {
        copy(precision = target)
    }
}

/** A lookup's answer. A class, not a data class: two identical answers are still two answers. */
private class PlaceAnswer(val request: PlaceRequest, val result: PlaceResult)

/** A place to write, at the precision it was looked up for. */
private data class FoundPlace(val place: SessionPlace, val precision: Precision)

private const val TAG = "TmlPings"
