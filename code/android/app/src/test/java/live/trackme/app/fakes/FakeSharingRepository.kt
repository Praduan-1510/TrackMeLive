package live.trackme.app.fakes

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import live.trackme.app.data.sharing.ActiveShare
import live.trackme.app.data.sharing.CreateShareResult
import live.trackme.app.data.sharing.DiscardShareResult
import live.trackme.app.data.sharing.SessionView
import live.trackme.app.data.sharing.ShareEnd
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.SharingRepository
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UpdateShareResult
import live.trackme.app.data.sharing.UploadStatus
import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import live.trackme.schema.SharerSnapshot
import live.trackme.schema.StopRule

/**
 * [SharingRepository] in memory, for view model and screen tests. Set [nextCreate] (and the other
 * `next…` results) before acting; drive the share with [mutableState] (or [emit]), [endWith] and
 * [now]. Every call is recorded.
 */
class FakeSharingRepository(startMillis: Long = START_MILLIS) : SharingRepository {
    /** Settable state. */
    val mutableState = MutableStateFlow<ShareState>(ShareState.Idle)
    override val state: StateFlow<ShareState> = mutableState.asStateFlow()

    /** The server's clock, as the fake sees it (what [serverNowMillis] returns). */
    var now: Long = startMillis

    override fun serverNowMillis(): Long = now

    val createRequests = mutableListOf<ShareRequest>()
    var nextCreate: (ShareRequest) -> CreateShareResult = { CreateShareResult.Created(shareFor(it)) }
    var nextDiscard: DiscardShareResult = DiscardShareResult.Discarded
    var nextUpdate: UpdateShareResult = UpdateShareResult.Updated
    val precisionChanges = mutableListOf<Precision>()
    val stopChanges = mutableListOf<StopChoice>()
    var discards = 0
        private set
    var stops = 0
        private set
    var dismissals = 0
        private set

    override suspend fun createSession(request: ShareRequest): CreateShareResult {
        createRequests += request
        val result = nextCreate(request)
        if (result is CreateShareResult.Created) {
            mutableState.value = ShareState.Live(result.share, sessionFor(result.share, request), UploadStatus.Initial.copy(precision = request.precision))
        }
        return result
    }

    override suspend fun discard(): DiscardShareResult {
        discards++
        if (nextDiscard == DiscardShareResult.Discarded) mutableState.value = ShareState.Idle
        return nextDiscard
    }

    override suspend fun stop(): ShareEnd? {
        stops++
        val live = mutableState.value as? ShareState.Live ?: return null
        val end = ShareEnd(EndReason.STOPPED, now, confirmed = true)
        mutableState.value = ShareState.Ended(live.share, end, live.session)
        return end
    }

    override suspend fun setPrecision(precision: Precision): UpdateShareResult {
        precisionChanges += precision
        return nextUpdate
    }

    override suspend fun changeStop(choice: StopChoice): UpdateShareResult {
        stopChanges += choice
        return nextUpdate
    }

    override fun dismissEnded() {
        dismissals++
        if (mutableState.value is ShareState.Ended) mutableState.value = ShareState.Idle
    }

    private val confirmation = MutableStateFlow(false)
    override val stopConfirmationRequested: StateFlow<Boolean> = confirmation.asStateFlow()

    override fun requestStopConfirmation() {
        confirmation.value = true
    }

    override fun consumeStopConfirmation() {
        confirmation.value = false
    }

    /** Sets the state directly, e.g. a Live share with a viewer who opened the link. */
    fun emit(state: ShareState) {
        mutableState.value = state
    }

    /** Ends the live share the way the server would: [reason] at [atMillis]. */
    fun endWith(reason: EndReason, atMillis: Long = now) {
        val live = mutableState.value as? ShareState.Live ?: return
        mutableState.value = ShareState.Ended(live.share, ShareEnd(reason, atMillis, confirmed = true), live.session)
    }

    companion object {
        /** Oct 17 2026, 21:38 UTC. */
        const val START_MILLIS = 1_792_273_080_000L

        fun shareFor(request: ShareRequest, startedAt: Long = START_MILLIS) = ActiveShare(
            sessionId = "session-1",
            linkUrl = "http://10.0.2.2:5002/s/AAAAAAAAAAAAAAAAAAAAAA",
            viewerName = request.viewerName,
            callId = request.callId,
            startedAtMillis = startedAt,
            expiresAtMillis = startedAt + 60 * 60_000L,
        )

        /** A session doc as createSession writes it. */
        fun sessionFor(share: ActiveShare, request: ShareRequest, name: String = "Alex"): SessionView {
            val (rule, minutes, stopAt) = when (val stop = request.stop) {
                StopChoice.WhenCallEnds -> Triple(StopRule.CALL, null, null)
                StopChoice.AtLimit -> Triple(StopRule.LIMIT, null, share.expiresAtMillis)
                is StopChoice.After -> Triple(
                    StopRule.MINUTES,
                    stop.minutes,
                    minOf(share.startedAtMillis + stop.minutes.minutes * 60_000L, share.expiresAtMillis),
                )
            }
            return SessionView(
                active = true,
                startedAtMillis = share.startedAtMillis,
                expiresAtMillis = share.expiresAtMillis,
                stopRule = rule,
                stopMinutes = minutes,
                stopAtMillis = stopAt,
                endedAtMillis = null,
                endReason = null,
                callId = request.callId,
                callActive = request.callId != null,
                callEndedAtMillis = null,
                shareBackAllowed = request.shareBackAllowed && request.callId != null,
                lastPingAtMillis = share.startedAtMillis,
                pingIntervalSeconds = 5.0,
                precision = request.precision,
                precisionNext = null,
                sharer = SharerSnapshot(name = name),
                firstViewedAtMillis = null,
                viewerSharing = false,
                shareBackRequestedAtMillis = null,
            )
        }
    }
}
