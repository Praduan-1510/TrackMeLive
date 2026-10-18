package live.trackme.app.fakes

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.transformWhile
import live.trackme.app.data.sharing.CheckInWrite
import live.trackme.app.data.sharing.PingWrite
import live.trackme.app.data.sharing.RemoteSession
import live.trackme.app.data.sharing.SessionDataSource
import live.trackme.app.data.sharing.ServerMarks
import live.trackme.app.data.sharing.SessionView
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.SharingDataException
import live.trackme.app.data.sharing.StopWrite
import live.trackme.schema.CreateSessionResponse
import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import live.trackme.schema.StopSessionResponse

/**
 * [SessionDataSource] in memory. The session doc is [remote] (what every listener sees); each call is
 * recorded, and each can be made to fail or (for writes) to hang as if offline.
 */
class FakeSessionDataSource(private val serverNow: () -> Long) : SessionDataSource {
    /** What listeners see. Null: nothing delivered yet. A [RemoteSession.Failed] ends the listener. */
    val remote = MutableStateFlow<RemoteSession?>(null)
    var listeners = 0
        private set
    var observeCalls = 0
        private set

    val creates = mutableListOf<ShareRequest>()
    var onCreate: (ShareRequest) -> CreateSessionResponse = { response() }

    val stops = mutableListOf<String>()
    var onStop: (String) -> StopSessionResponse = { StopSessionResponse(it, serverNow(), EndReason.STOPPED) }

    val discards = mutableListOf<String>()
    var onDiscard: (String) -> Unit = {}

    data class Write(val sessionId: String, val ping: PingWrite?, val checkIn: CheckInWrite, val atServerMillis: Long)

    /** Writes the server has confirmed. */
    val writes = mutableListOf<Write>()

    /** Writes started, confirmed or not. */
    var writesStarted = 0
        private set

    /** When set, every write waits for it (offline); completing it lets them through. */
    var writeGate: CompletableDeferred<Unit>? = null

    /** When set, every write fails with it. */
    var writeFailure: SharingDataException? = null

    /** What a server read of the session says; by default the confirmed writes' check-in and newest fix. */
    var marks: () -> ServerMarks = {
        ServerMarks(lastPingAtMillis = writes.lastOrNull()?.atServerMillis ?: serverNow(), lastFixAtMillis = writes.lastOrNull { it.ping != null }?.ping?.recordedAtMillis)
    }
    var markReads = 0
        private set

    val precisionNexts = mutableListOf<Precision?>()
    val stopWrites = mutableListOf<StopWrite>()
    var updateFailure: SharingDataException? = null

    override suspend fun create(request: ShareRequest): CreateSessionResponse {
        creates += request
        return onCreate(request)
    }

    override suspend fun stop(sessionId: String): StopSessionResponse {
        stops += sessionId
        return onStop(sessionId)
    }

    override suspend fun discard(sessionId: String) {
        discards += sessionId
        onDiscard(sessionId)
    }

    override fun observe(sessionId: String): Flow<RemoteSession> = remote.filterNotNull()
        .transformWhile {
            emit(it)
            it !is RemoteSession.Failed
        }
        .onStart {
            observeCalls++
            listeners++
        }
        .onCompletion { listeners-- }

    override suspend fun write(sessionId: String, ping: PingWrite?, checkIn: CheckInWrite) {
        writesStarted++
        writeGate?.await()
        writeFailure?.let { throw it }
        writes += Write(sessionId, ping, checkIn, serverNow())
    }

    override suspend fun serverMarks(sessionId: String): ServerMarks {
        markReads++
        return marks()
    }

    override suspend fun setPrecisionNext(sessionId: String, precision: Precision?) {
        updateFailure?.let { throw it }
        precisionNexts += precision
    }

    override suspend fun setStop(sessionId: String, stop: StopWrite) {
        updateFailure?.let { throw it }
        stopWrites += stop
    }

    /** Delivers [view] to the listeners, as the server's (confirmed) snapshot. */
    fun deliver(view: SessionView, hasPendingWrites: Boolean = false) {
        remote.value = RemoteSession.Present(view, hasPendingWrites)
    }

    fun response(
        sessionId: String = "session-1",
        startedAt: Long = serverNow(),
        token: String = "AAAAAAAAAAAAAAAAAAAAAA",
    ) = CreateSessionResponse(
        sessionId = sessionId,
        linkToken = token,
        linkUrl = "http://10.0.2.2:5002/s/$token",
        startedAt = startedAt,
        expiresAt = startedAt + 60 * 60_000L,
    )
}
