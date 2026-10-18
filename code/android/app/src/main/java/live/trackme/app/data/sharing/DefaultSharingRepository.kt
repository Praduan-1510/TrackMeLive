package live.trackme.app.data.sharing

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import live.trackme.app.domain.Clock
import live.trackme.app.domain.ServerClock
import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import live.trackme.schema.StopRule

/**
 * [SharingRepository] over a [SessionDataSource], for whoever [userId] says is signed in.
 *
 * A share runs from [createSession] until [dismissEnded]. While it's live, three things run in [scope]:
 * the session doc's listener (restarted with backoff when it fails), a timer for the end that's due
 * (stop_at or expires_at, on the server's clock), and the [uploader]. The location foreground service
 * runs alongside, through [service]. The moment the share is over (Stop, the server ending it, or the
 * due end passing, even offline), the uploader is cancelled and the service stopped, before anything else
 * happens.
 *
 * The share is kept in [store], so after the process is killed the next start picks it up again: the
 * listener says whether it's still live, and if so pings and the service resume.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DefaultSharingRepository(
    /** Who is signed in, observed over time: signing out forgets the share. */
    private val userId: StateFlow<String?>,
    /** Who is signed in right now, settled (AuthRepository.currentUserId), for decisions made on the spot. */
    private val currentUserId: () -> String?,
    private val source: SessionDataSource,
    private val uploader: PingUploader,
    private val store: ShareStore,
    private val service: SharingServiceController,
    private val serverClock: ServerClock,
    private val clock: Clock,
    private val scope: CoroutineScope,
    /** Location is allowed (While using the app or Only this time). */
    private val hasLocationPermission: () -> Boolean,
    private val push: PushRegistration = PushRegistration.None,
    /** Called when a callable says the sign-in has ended, to treat it as signed out (AccountSession). */
    private val onSignInEnded: suspend () -> Unit = {},
) : SharingRepository {

    /** The share on this phone; [localEnd] is an end known here before (or without) the server's. */
    private data class Current(val userId: String, val share: ActiveShare, val localEnd: ShareEnd? = null)

    private val current = MutableStateFlow<Current?>(null)
    private val session = MutableStateFlow<SessionView?>(null)
    private val mutableState = MutableStateFlow<ShareState>(ShareState.Idle)
    override val state: StateFlow<ShareState> = mutableState.asStateFlow()

    private val confirmation = MutableStateFlow(false)
    override val stopConfirmationRequested: StateFlow<Boolean> = confirmation.asStateFlow()

    private val starting = Mutex()

    /** The listener and the end timer: for as long as there's a share. */
    private var watchJobs: List<Job> = emptyList()

    /** The uploader: only while the share is live. */
    private var uploadJob: Job? = null

    init {
        store.loadClockOffset()?.let(serverClock::restore)
        restore()
        scope.launch { uploader.status.collect { recompute() } }
        scope.launch {
            userId.collect {
                val share = current.value ?: return@collect
                // Judged by who is signed in now, so a change still on its way can't forget a new share.
                if (share.userId != currentUserId()) {
                    Log.i(TAG, "signed out while a share was kept: forgetting it")
                    forget()
                }
            }
        }
    }

    override fun serverNowMillis(): Long = serverClock.nowMillis()

    // ---- Starting --------------------------------------------------------

    override suspend fun createSession(request: ShareRequest): CreateShareResult = starting.withLock {
        val uid = currentUserId() ?: return CreateShareResult.Failed(SharingFailure.NotSignedIn)
        when (val state = mutableState.value) {
            is ShareState.Live -> return CreateShareResult.AlreadySharing(state.share.sessionId)
            // Share again from the ended screen.
            is ShareState.Ended -> dismissEnded()
            ShareState.Idle -> Unit
        }
        // Following the call needs the call (Sprint 3); without one there's nothing to follow.
        if (request.stop == StopChoice.WhenCallEnds && request.callId == null) {
            return CreateShareResult.Failed(SharingFailure.Invalid)
        }
        if (!hasLocationPermission()) return CreateShareResult.Failed(SharingFailure.LocationPermission)

        val sentAt = clock.elapsedMillis()
        val response = try {
            source.create(request)
        } catch (e: SharingDataException) {
            e.activeSessionId?.let { return CreateShareResult.AlreadySharing(it) }
            if (e.reason == SharingFailure.SignInEnded) scope.launch { onSignInEnded() }
            return CreateShareResult.Failed(e.reason)
        }
        serverClock.observe(response.startedAt, sentAt)
        saveClockOffset()

        val share = ActiveShare(
            sessionId = response.sessionId,
            linkUrl = response.linkUrl,
            viewerName = request.viewerName,
            callId = request.callId,
            startedAtMillis = response.startedAt,
            expiresAtMillis = response.expiresAt,
        )
        try {
            service.start()
        } catch (e: ForegroundStartRefused) {
            // Android won't run the location service now, so nothing could be shared: take it back.
            Log.w(TAG, "location service refused to start; discarding the new session", e)
            scope.launch { discardQuietly(share.sessionId) }
            return CreateShareResult.Failed(SharingFailure.NotInForeground)
        }
        store.save(StoredShare(uid, share))
        begin(Current(uid, share))
        scope.launch { push.ensureRegistered() }
        CreateShareResult.Created(share)
    }

    /** Picks up a share kept from before the process was killed. */
    private fun restore() {
        val stored = store.load() ?: return
        if (stored.userId != currentUserId()) {
            store.clear()
            return
        }
        begin(Current(stored.userId, stored.share))
    }

    private fun begin(next: Current) {
        session.value = null
        current.value = next
        val id = next.share.sessionId
        watchJobs = listOf(
            scope.launch { observe(id) },
            scope.launch { endTimer() },
        )
        recompute()
    }

    // ---- The session doc -------------------------------------------------

    /**
     * shareSessions/{id}, kept alive: when the listener fails it starts again after 2, 4, 8, 16 and
     * 32 s, then every 60 s. The local end timer keeps working meanwhile.
     */
    private suspend fun observe(sessionId: String) {
        var failures = 0
        while (true) {
            // Snapshots until the doc is gone or the listener fails (which ends the flow).
            val last = source.observe(sessionId).firstOrNull { snapshot ->
                if (snapshot is RemoteSession.Present) {
                    failures = 0
                    session.value = snapshot.session
                    recompute()
                }
                snapshot !is RemoteSession.Present
            }
            val failure = when (last) {
                RemoteSession.Missing -> SharingFailure.NotSharing
                is RemoteSession.Failed -> last.reason
                else -> SharingFailure.Other
            }
            when (failure) {
                // Gone: discarded, deleted with the account, or no longer this account's.
                SharingFailure.NotSharing -> {
                    if (current.value?.share?.sessionId == sessionId) {
                        Log.i(TAG, "the session is gone; forgetting the share")
                        forget()
                    }
                    return
                }
                SharingFailure.SignInEnded -> {
                    onSignInEnded()
                    return
                }
                else -> Unit
            }
            failures++
            delay(retryDelayMillis(failures))
        }
    }

    /** Wakes at the end that's due (stop_at or expires_at, server time), so the share ends on time offline. */
    private suspend fun endTimer() {
        session.collectLatest { view ->
            while (true) {
                val share = current.value?.share ?: return@collectLatest
                // No server time yet (after a reboot): look again until the first check-in brings it.
                val now = serverClock.syncedNowMillis()
                if (now == null) {
                    delay(UNSYNCED_POLL_MS)
                    recompute()
                    continue
                }
                val wait = (view?.endsAtMillis ?: share.expiresAtMillis) - now
                if (wait > 0) delay(wait)
                recompute()
                return@collectLatest
            }
        }
    }

    // ---- State -----------------------------------------------------------

    /** Works out [state] from the share, the session doc and the clock, and starts or stops what follows. */
    private fun recompute() {
        val now = current.value
        if (now == null) {
            mutableState.value = ShareState.Idle
            return
        }
        val view = session.value
        val serverNow = serverClock.syncedNowMillis()
        val due = view?.endAt(serverNow)
            ?: ShareEnd(EndReason.LIMIT, now.share.expiresAtMillis, confirmed = false)
                .takeIf { view == null && serverNow != null && serverNow >= it.atMillis }
        val end = earlierOf(now.localEnd, due)
        if (end == null) {
            mutableState.value = ShareState.Live(now.share, view, uploader.status.value)
            startUploading(now.share)
            return
        }
        // Over: stop writing first, then everything else.
        stopUploading()
        if (end != now.localEnd) current.value = now.copy(localEnd = end)
        mutableState.value = ShareState.Ended(now.share, end, view)
    }

    /** The server's recorded end wins; otherwise whichever came first. */
    private fun earlierOf(a: ShareEnd?, b: ShareEnd?): ShareEnd? = when {
        a == null -> b
        b == null -> a
        b.confirmed && !a.confirmed -> b
        a.confirmed && !b.confirmed -> a
        b.atMillis < a.atMillis -> b
        else -> a
    }

    private fun startUploading(share: ActiveShare) {
        if (uploadJob?.isActive == true) return
        ensureService()
        uploadJob = scope.launch { uploader.run(share, session) }
    }

    private fun stopUploading() {
        uploadJob?.cancel()
        uploadJob = null
        service.stop()
    }

    /** A share picked up after a restart needs its service again; Android allows that only in the foreground. */
    private fun ensureService() {
        if (service.isRunning) return
        // Without location the service couldn't enter the foreground (Android 14+ refuses the type).
        if (!hasLocationPermission()) {
            Log.w(TAG, "no location permission: the location service stays off")
            return
        }
        try {
            service.start()
        } catch (e: ForegroundStartRefused) {
            Log.w(TAG, "location service can't start now; will retry when the app is in the foreground", e)
        }
    }

    /** The app came to the foreground: a live share whose service couldn't start gets it now. */
    fun onAppForeground() {
        if (mutableState.value is ShareState.Live) ensureService()
    }

    // ---- Stopping --------------------------------------------------------

    override suspend fun stop(): ShareEnd? {
        val now = current.value ?: return null
        if (mutableState.value !is ShareState.Live) return (mutableState.value as? ShareState.Ended)?.end
        val local = ShareEnd(EndReason.STOPPED, serverClock.nowMillis(), confirmed = false)
        current.value = now.copy(localEnd = local)
        recompute()
        val sessionId = now.share.sessionId
        scope.launch { tellServerStopped(sessionId) }
        return (mutableState.value as? ShareState.Ended)?.end
    }

    /** stopSession, retried with backoff until the server has it; its answer replaces the local end. */
    private suspend fun tellServerStopped(sessionId: String) {
        var failures = 0
        while (true) {
            try {
                val response = source.stop(sessionId)
                val confirmed = ShareEnd(response.endReason, response.endedAt, confirmed = true)
                val now = current.value
                if (now != null && now.share.sessionId == sessionId) {
                    current.value = now.copy(localEnd = confirmed)
                    recompute()
                }
                return
            } catch (e: SharingDataException) {
                when (e.reason) {
                    SharingFailure.Network, SharingFailure.Other -> Unit
                    SharingFailure.SignInEnded -> return onSignInEnded()
                    // Gone, or not ours: nothing left to stop.
                    else -> return
                }
            }
            failures++
            delay(retryDelayMillis(failures))
        }
    }

    override suspend fun discard(): DiscardShareResult {
        val now = current.value ?: return DiscardShareResult.Failed(SharingFailure.NotSharing)
        if (now.localEnd != null || mutableState.value !is ShareState.Live) {
            return DiscardShareResult.Failed(SharingFailure.NotSharing)
        }
        // Nothing more is written while the server decides.
        stopUploading()
        return try {
            source.discard(now.share.sessionId)
            forget()
            DiscardShareResult.Discarded
        } catch (e: SharingDataException) {
            if (e.linkOpened) {
                // Someone already opened it: it can't be taken back, so the share goes on.
                recompute()
                return DiscardShareResult.LinkOpened
            }
            // Couldn't reach the server: stop sharing all the same (the server ends it as stopped) and
            // leave the share screen; nobody was sent the link.
            Log.w(TAG, "discard failed (${e.reason}); stopping instead", e)
            val sessionId = now.share.sessionId
            forget()
            scope.launch { if (!discardQuietly(sessionId)) tellServerStopped(sessionId) }
            if (e.reason == SharingFailure.SignInEnded) scope.launch { onSignInEnded() }
            DiscardShareResult.Failed(e.reason)
        }
    }

    /** discardSession once, for clean-up; true when it worked. */
    private suspend fun discardQuietly(sessionId: String): Boolean = try {
        source.discard(sessionId)
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: SharingDataException) {
        Log.w(TAG, "discard failed: ${e.reason}", e)
        false
    }

    override fun dismissEnded() {
        if (mutableState.value is ShareState.Ended) forget()
    }

    /** Back to Idle: everything for the share stops, and the phone forgets it. */
    private fun forget() {
        stopUploading()
        watchJobs.forEach { it.cancel() }
        watchJobs = emptyList()
        current.value = null
        session.value = null
        store.clear()
        confirmation.value = false
        recompute()
    }

    // ---- Changes while live ----------------------------------------------

    override suspend fun setPrecision(precision: Precision): UpdateShareResult {
        val (sessionId, view) = liveSession() ?: return UpdateShareResult.Failed(SharingFailure.NotSharing)
        val next = precision.takeIf { it != view.precision }
        if (next == view.precisionNext) return UpdateShareResult.Updated
        return update { source.setPrecisionNext(sessionId, next) }
    }

    override suspend fun changeStop(choice: StopChoice): UpdateShareResult {
        // The share itself has what a timer needs, so this works before the first snapshot too.
        val live = mutableState.value as? ShareState.Live ?: return UpdateShareResult.Failed(SharingFailure.NotSharing)
        val expiresAt = live.session?.expiresAtMillis ?: live.share.expiresAtMillis
        val write = when (choice) {
            StopChoice.WhenCallEnds -> {
                if (live.share.callId == null || live.session?.callEndedAtMillis != null) {
                    return UpdateShareResult.Failed(SharingFailure.Invalid)
                }
                StopWrite(StopRule.CALL, null, null)
            }
            StopChoice.AtLimit -> StopWrite(StopRule.LIMIT, null, expiresAt)
            // On the server's clock; the rules allow 60 s either way.
            is StopChoice.After -> StopWrite(
                StopRule.MINUTES,
                choice.minutes,
                minOf(serverClock.nowMillis() + choice.minutes.minutes * 60_000L, expiresAt),
            )
        }
        return update { source.setStop(live.share.sessionId, write) }
    }

    private fun liveSession(): Pair<String, SessionView>? {
        val live = mutableState.value as? ShareState.Live ?: return null
        val view = live.session ?: return null
        return live.share.sessionId to view
    }

    private suspend fun update(block: suspend () -> Unit): UpdateShareResult = try {
        block()
        UpdateShareResult.Updated
    } catch (e: SharingDataException) {
        if (e.reason == SharingFailure.SignInEnded) scope.launch { onSignInEnded() }
        UpdateShareResult.Failed(e.reason)
    }

    // ---- The ongoing notification's Stop sharing ---------------------------

    override fun requestStopConfirmation() {
        if (mutableState.value is ShareState.Live) confirmation.value = true
    }

    override fun consumeStopConfirmation() {
        confirmation.value = false
    }

    private fun saveClockOffset() {
        serverClock.offsetMillis?.let(store::saveClockOffset)
    }

    internal companion object {
        /** Without server time, how often the end timer looks again. */
        const val UNSYNCED_POLL_MS = 5_000L

        /** After the nth failure in a row: 2, 4, 8, 16, 32 s, then every 60 s. */
        fun retryDelayMillis(failures: Int): Long = if (failures >= 6) 60_000L else 1_000L shl failures.coerceAtLeast(1)
    }
}

private const val TAG = "TmlSharing"
