package live.trackme.app.data.sharing

import android.util.Log
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Source
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.tasks.await
import live.trackme.schema.CreateSessionRequest
import live.trackme.schema.CreateSessionResponse
import live.trackme.schema.DiscardSessionRequest
import live.trackme.schema.EndReason
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotCatalog
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.Ping
import live.trackme.schema.Precision
import live.trackme.schema.SessionStatus
import live.trackme.schema.ShareSession
import live.trackme.schema.SharerSnapshot
import live.trackme.schema.StopMinutes
import live.trackme.schema.StopRule
import live.trackme.schema.StopSessionRequest
import live.trackme.schema.StopSessionResponse
import live.trackme.schema.TmlCallables
import live.trackme.schema.TmlPaths
import live.trackme.schema.TmlSchemaConstants

/**
 * [SessionDataSource] on the session callables (createSession, stopSession, discardSession) and
 * shareSessions/{id} with its pings. [firestore] gives the current instance: deleting an account
 * replaces it (FirebaseServices.clearFirestoreCache).
 */
class FirestoreSessionDataSource(
    private val firestore: () -> FirebaseFirestore,
    private val functions: FirebaseFunctions,
) : SessionDataSource {

    override suspend fun create(request: ShareRequest): CreateSessionResponse {
        val payload = CreateSessionRequest(
            stopRule = request.stop.rule,
            stopMinutes = (request.stop as? StopChoice.After)?.minutes,
            callId = request.callId,
            shareBackAllowed = request.shareBackAllowed,
            precision = request.precision,
            viewerName = request.viewerName,
        ).toMap()
        val data = call(TmlCallables.CREATE_SESSION, payload)
        return parse { CreateSessionResponse.fromMap(data) }
    }

    override suspend fun stop(sessionId: String): StopSessionResponse {
        val data = call(TmlCallables.STOP_SESSION, StopSessionRequest(sessionId).toMap())
        return parse { StopSessionResponse.fromMap(data) }
    }

    override suspend fun discard(sessionId: String) {
        try {
            call(TmlCallables.DISCARD_SESSION, DiscardSessionRequest(sessionId).toMap())
        } catch (e: SharingDataException) {
            // Already gone (a retry after a lost answer): done.
            if (e.reason != SharingFailure.NotSharing) throw e
        }
    }

    override fun observe(sessionId: String): Flow<RemoteSession> = callbackFlow {
        // Metadata changes too, so the end of hasPendingWrites (the server confirmed a write) is seen.
        val registration = firestore().document(TmlPaths.shareSession(sessionId))
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                when {
                    error != null -> {
                        Log.w(TAG, "shareSessions/{id} listener stopped: ${error.code}")
                        trySend(RemoteSession.Failed(firestoreFailureOf(error)))
                        close()
                    }
                    snapshot == null -> Unit
                    snapshot.exists() -> snapshot.toSessionViewOrNull()?.let {
                        trySend(RemoteSession.Present(it, snapshot.metadata.hasPendingWrites()))
                    }
                    // Not in the cache tells nothing yet: wait for the server before saying it's gone.
                    snapshot.metadata.isFromCache -> Unit
                    else -> trySend(RemoteSession.Missing)
                }
            }
        awaitClose {
            try {
                registration.remove()
            } catch (_: IllegalStateException) {
                // The instance was terminated (Delete account): the listener is already gone.
            }
        }
    }.distinctUntilChanged()

    override suspend fun write(sessionId: String, ping: PingWrite?, checkIn: CheckInWrite) {
        val db = firestore()
        val sessionRef = db.document(TmlPaths.shareSession(sessionId))
        val batch = db.batch()
        // The ping's recorded_at and the session's last_fix_at are the very same value (the rules compare them).
        val recordedAt = ping?.let { timestampOf(it.recordedAtMillis) }
        if (ping != null && recordedAt != null) {
            val ref = db.collection(TmlPaths.pingCollection(sessionId)).document()
            batch.set(ref, Ping(lat = ping.lat, lng = ping.lng, accuracyM = ping.accuracyM, recordedAt = recordedAt))
        }
        val fields = buildMap<String, Any?> {
            put(ShareSession.Fields.LAST_PING_AT, FieldValue.serverTimestamp())
            recordedAt?.let { put(ShareSession.Fields.LAST_FIX_AT, it) }
            checkIn.pingIntervalSeconds?.let { put(ShareSession.Fields.PING_INTERVAL_S, it) }
            checkIn.applyPrecision?.let {
                put(ShareSession.Fields.PRECISION, it.wire)
                put(ShareSession.Fields.PRECISION_NEXT, null)
            }
        }
        batch.update(sessionRef, fields)
        firestoreCall("ping") { batch.commit().await() }
    }

    override suspend fun serverMarks(sessionId: String): ServerMarks {
        val snapshot = firestoreCall("session read") {
            firestore().document(TmlPaths.shareSession(sessionId)).get(Source.SERVER).await()
        }
        fun millis(field: String) = snapshot.getTimestamp(field)?.let { it.seconds * 1000L + it.nanoseconds / 1_000_000 }
        return ServerMarks(
            lastPingAtMillis = millis(ShareSession.Fields.LAST_PING_AT) ?: throw SharingDataException(SharingFailure.NotSharing),
            lastFixAtMillis = millis(ShareSession.Fields.LAST_FIX_AT),
        )
    }

    override suspend fun setPrecisionNext(sessionId: String, precision: Precision?) {
        firestoreCall("precision_next") {
            firestore().document(TmlPaths.shareSession(sessionId))
                .update(ShareSession.Fields.PRECISION_NEXT, precision?.wire).await()
        }
    }

    override suspend fun setStop(sessionId: String, stop: StopWrite) {
        val fields = mapOf<String, Any?>(
            ShareSession.Fields.STOP_RULE to stop.rule.wire,
            ShareSession.Fields.STOP_MINUTES to stop.minutes?.minutes,
            ShareSession.Fields.STOP_AT to stop.stopAtMillis?.let(::timestampOf),
        )
        // In a transaction, which needs the server: offline it fails at once (Network) instead of queueing a
        // change the rules would refuse once it lands more than a minute late.
        firestoreCall("stop rule") {
            val db = firestore()
            val ref = db.document(TmlPaths.shareSession(sessionId))
            db.runTransaction { tx ->
                tx.get(ref)
                tx.update(ref, fields)
            }.await()
        }
    }

    private suspend fun call(name: String, payload: Map<String, Any?>): Map<*, *> {
        val data = try {
            functions.getHttpsCallable(name)
                .apply { setTimeout(CALL_TIMEOUT_S, TimeUnit.SECONDS) }
                .call(payload).await().getData()
        } catch (e: CancellationException) {
            throw e
        } catch (e: FirebaseFunctionsException) {
            Log.w(TAG, "$name failed: ${e.code} ${reasonOf(e.details)}", e)
            throw functionsExceptionOf(e)
        } catch (e: FirebaseNetworkException) {
            Log.w(TAG, "$name failed: no connection", e)
            throw SharingDataException(SharingFailure.Network, e)
        }
        return data as? Map<*, *> ?: emptyMap<String, Any?>()
    }

    private inline fun <T> parse(block: () -> T): T = try {
        block()
    } catch (e: IllegalArgumentException) {
        throw SharingDataException(SharingFailure.Other, e)
    }

    private suspend fun <T> firestoreCall(what: String, block: suspend () -> T): T = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: FirebaseFirestoreException) {
        Log.w(TAG, "$what failed: ${e.code}", e)
        throw SharingDataException(firestoreFailureOf(e), e)
    }

    internal companion object {
        const val CALL_TIMEOUT_S = 20L

        fun functionsExceptionOf(e: FirebaseFunctionsException): SharingDataException {
            val reason = reasonOf(e.details)
            return when (e.code) {
                FirebaseFunctionsException.Code.UNAUTHENTICATED -> SharingDataException(SharingFailure.SignInEnded, e)
                FirebaseFunctionsException.Code.PERMISSION_DENIED -> SharingDataException(SharingFailure.NotSignedIn, e)
                FirebaseFunctionsException.Code.INVALID_ARGUMENT -> SharingDataException(SharingFailure.Invalid, e)
                FirebaseFunctionsException.Code.NOT_FOUND -> SharingDataException(SharingFailure.NotSharing, e)
                FirebaseFunctionsException.Code.ALREADY_EXISTS -> SharingDataException(
                    SharingFailure.Other,
                    e,
                    activeSessionId = (e.details as? Map<*, *>)?.get("session_id") as? String,
                )
                FirebaseFunctionsException.Code.FAILED_PRECONDITION -> when (reason) {
                    "no_profile" -> SharingDataException(SharingFailure.NoProfile, e)
                    "link_opened" -> SharingDataException(SharingFailure.Other, e, linkOpened = true)
                    else -> SharingDataException(SharingFailure.Other, e)
                }
                FirebaseFunctionsException.Code.UNAVAILABLE, FirebaseFunctionsException.Code.DEADLINE_EXCEEDED ->
                    SharingDataException(SharingFailure.Network, e)
                // The SDK reports a dropped connection as INTERNAL caused by an IOException.
                FirebaseFunctionsException.Code.INTERNAL ->
                    SharingDataException(if (e.cause is IOException) SharingFailure.Network else SharingFailure.Other, e)
                else -> SharingDataException(SharingFailure.Other, e)
            }
        }

        fun firestoreFailureOf(e: FirebaseFirestoreException): SharingFailure = when (e.code) {
            FirebaseFirestoreException.Code.UNAVAILABLE, FirebaseFirestoreException.Code.DEADLINE_EXCEEDED -> SharingFailure.Network
            FirebaseFirestoreException.Code.UNAUTHENTICATED -> SharingFailure.SignInEnded
            // Not the owner any more, or the session is over: the rules refuse every write after the end.
            FirebaseFirestoreException.Code.PERMISSION_DENIED, FirebaseFirestoreException.Code.NOT_FOUND -> SharingFailure.NotSharing
            else -> SharingFailure.Other
        }

        /** The `reason` in failed-precondition details: `{reason: "link_opened"}`. */
        fun reasonOf(details: Any?): String? = (details as? Map<*, *>)?.get("reason") as? String

        fun timestampOf(millis: Long): Timestamp =
            Timestamp(Math.floorDiv(millis, 1000L), (Math.floorMod(millis, 1000L) * 1_000_000).toInt())
    }
}

/** The schema's stop rule for a choice. */
internal val StopChoice.rule: StopRule
    get() = when (this) {
        StopChoice.WhenCallEnds -> StopRule.CALL
        is StopChoice.After -> StopRule.MINUTES
        StopChoice.AtLimit -> StopRule.LIMIT
    }

/** A session doc the schema can't read is skipped (it never should happen) rather than ending the share. */
private fun DocumentSnapshot.toSessionViewOrNull(): SessionView? {
    // Server timestamps still pending (this phone's last check-in) read as the local estimate.
    val data = getData(DocumentSnapshot.ServerTimestampBehavior.ESTIMATE) ?: return null
    return try {
        sessionViewOf(data)
    } catch (e: RuntimeException) {
        // A missing field (IllegalArgumentException) or one of the wrong type (ClassCastException).
        Log.w(TAG, "shareSessions/{id} doesn't match the schema", e)
        null
    }
}

/**
 * shareSessions/{id} from its fields. Read by hand rather than with toObject: stop_minutes is a number
 * on the wire, and Firestore's mapper reads enums only from strings.
 */
internal fun sessionViewOf(data: Map<String, Any?>): SessionView {
    fun time(key: String): Long? = (data[key] as Timestamp?)?.millis
    fun required(key: String): Long = requireNotNull(time(key)) { "$key is missing" }
    fun <T> wire(key: String, of: (String?) -> T?): T? = of(data[key] as String?)
    return SessionView(
        active = requireNotNull(wire(ShareSession.Fields.STATUS, SessionStatus::fromWire)) { "status is missing" } == SessionStatus.ACTIVE,
        startedAtMillis = required(ShareSession.Fields.STARTED_AT),
        expiresAtMillis = required(ShareSession.Fields.EXPIRES_AT),
        stopRule = requireNotNull(wire(ShareSession.Fields.STOP_RULE, StopRule::fromWire)) { "stop_rule is missing" },
        stopMinutes = StopMinutes.fromMinutes((data[ShareSession.Fields.STOP_MINUTES] as Number?)?.toInt()),
        stopAtMillis = time(ShareSession.Fields.STOP_AT),
        endedAtMillis = time(ShareSession.Fields.ENDED_AT),
        endReason = wire(ShareSession.Fields.END_REASON, EndReason::fromWire),
        callId = data[ShareSession.Fields.CALL_ID] as String?,
        callActive = data[ShareSession.Fields.CALL_ACTIVE] as Boolean? ?: false,
        callEndedAtMillis = time(ShareSession.Fields.CALL_ENDED_AT),
        shareBackAllowed = data[ShareSession.Fields.SHARE_BACK_ALLOWED] as Boolean? ?: false,
        lastPingAtMillis = required(ShareSession.Fields.LAST_PING_AT),
        // Missing on sessions started before the field existed: null, as the schema says.
        lastFixAtMillis = time(ShareSession.Fields.LAST_FIX_AT),
        pingIntervalSeconds = (data[ShareSession.Fields.PING_INTERVAL_S] as Number?)?.toDouble()
            ?: TmlSchemaConstants.INITIAL_PING_INTERVAL_SECONDS.toDouble(),
        precision = requireNotNull(wire(ShareSession.Fields.PRECISION, Precision::fromWire)) { "precision is missing" },
        precisionNext = wire(ShareSession.Fields.PRECISION_NEXT, Precision::fromWire),
        sharer = sharerOf(data[ShareSession.Fields.SHARER] as Map<*, *>?),
        firstViewedAtMillis = time(ShareSession.Fields.FIRST_VIEWED_AT),
        viewerSharing = data[ShareSession.Fields.VIEWER_SHARING] as Boolean? ?: false,
        shareBackRequestedAtMillis = time(ShareSession.Fields.SHARE_BACK_REQUESTED_AT),
    )
}

private fun sharerOf(map: Map<*, *>?): SharerSnapshot = SharerSnapshot(
    name = map?.get(SharerSnapshot.Fields.NAME) as String? ?: "",
    mascotId = MascotId.fromWire(map?.get(SharerSnapshot.Fields.MASCOT_ID) as String?) ?: MascotCatalog.DEFAULT_MASCOT,
    mascotColor = MascotColor.fromWire(map?.get(SharerSnapshot.Fields.MASCOT_COLOR) as String?) ?: MascotCatalog.DEFAULT_COLOR,
    mascotAccessory = MascotAccessory.fromWire(map?.get(SharerSnapshot.Fields.MASCOT_ACCESSORY) as String?),
)

private val Timestamp.millis: Long get() = seconds * 1000L + nanoseconds / 1_000_000

private const val TAG = "TmlSharing"
