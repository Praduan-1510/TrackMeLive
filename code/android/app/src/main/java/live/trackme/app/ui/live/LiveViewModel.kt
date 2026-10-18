package live.trackme.app.ui.live

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import live.trackme.app.data.location.LocationPermissions
import live.trackme.app.data.location.PermissionStatus
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.sharing.GpsSignal
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.SharedPoint
import live.trackme.app.data.sharing.SharingRepository
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UpdateShareResult
import live.trackme.app.di.AppContainer
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.share.Audience
import live.trackme.app.ui.share.ShareSheetContent
import live.trackme.app.ui.share.StopChoices
import live.trackme.schema.Precision
import live.trackme.schema.StopRule

/** Whether the sharer's own points are getting out (FSD §7 Offline behavior). */
enum class SharerSignal {
    Live,

    /** No fix better than 100 m for 30 s. */
    NoGps,

    /** Writes aren't reaching the server. */
    Offline,
}

/**
 * The live screen (prototype › viewLive, a manual share): everything it shows, worked out from the
 * share, the session doc, the pings and the server's clock, so the screen only lays it out.
 */
@Immutable
data class LiveUiState(
    /** False until there's a live share to show (the screen then stays empty for a moment). */
    val live: Boolean = false,
    val audience: Audience = Audience.None,
    /** The mascot the share started with: its marker keeps it until the share ends. */
    val look: MascotLook = MascotLook(),
    /** The server's clock now, epoch ms. */
    val nowMillis: Long = 0,
    val startedAtMillis: Long = 0,
    val expiresAtMillis: Long = 0,
    /** When sharing ends at the latest: the earlier of the timer and the 1-hour limit. */
    val endsAtMillis: Long = 0,
    /** The session follows the call (Sprint 3); otherwise a timer or the limit. */
    val followsCall: Boolean = false,
    val stop: StopChoice = StopChoice.AtLimit,
    val stopOptions: List<StopChoice> = emptyList(),
    /** The 1-hour warning: "Sharing stops at 10:38 pm · 1-hour limit", from 5 minutes before. */
    val limitSoon: Boolean = false,
    /** When the person opened the link, or null before. */
    val openedAtMillis: Long? = null,
    val signal: SharerSignal = SharerSignal.Live,
    /** The ping interval in use, in seconds. */
    val intervalSeconds: Double = 5.0,
    /** The precision the pings are written at now. */
    val precision: Precision = Precision.PRECISE,
    /** What the Location control shows: a change on its way, or [precision]. */
    val precisionShown: Precision = Precision.PRECISE,
    /** The newest point written, for the map, or null before the first. */
    val point: SharedPoint? = null,
    /** True while the Stop sharing? dialog is up. */
    val confirmingStop: Boolean = false,
    /** Stop was confirmed: waiting for the ended screen. */
    val stopping: Boolean = false,
    /** "Know when Mom opens it": the notification explainer, right after the first link went out. */
    val askAlerts: Boolean = false,
    /** For Send link again. */
    val link: ShareSheetContent? = null,
) {
    /** A change of Location detail waits for the next ping. */
    val precisionPending: Boolean get() = precisionShown != precision
}

/** What the live screen asks its host to do. */
sealed interface LiveEvent {
    /** Ask the system for precise location. */
    data object RequestPrecise : LiveEvent

    /** Ask for notifications (Android 13+). */
    data class RequestNotifications(val permission: String) : LiveEvent

    /** A change didn't reach the server: say so in a snackbar. */
    data object UpdateFailed : LiveEvent
}

/**
 * The live screen: the map, the sheet's tiles and rows, Location detail mid-session, the timer, Send
 * link again and Stop (FSD §4 Live map link, Location detail, Stop rule, 1-hour warning, Stop sharing).
 *
 * Stop always asks first. The ongoing notification's Stop sharing opens the app with the same question
 * ([SharingRepository.stopConfirmationRequested]). When the share ends, by Stop, the timer or the
 * limit, the app moves on to the ended screen by itself.
 */
class LiveViewModel(
    private val sharing: SharingRepository,
    private val permissions: LocationPermissions,
    askAlerts: Boolean,
    private val profileName: () -> String,
) : ViewModel() {

    private data class Local(
        val requestedPrecision: Precision? = null,
        val confirmingStop: Boolean = false,
        val stopping: Boolean = false,
        val askAlerts: Boolean = false,
    )

    private val local = MutableStateFlow(Local(askAlerts = askAlerts && canAskAlerts()))

    private val _events = Channel<LiveEvent>(Channel.BUFFERED)
    val events: Flow<LiveEvent> = _events.receiveAsFlow()

    /** The server's clock, once a second: durations, the limit line and the timer choices follow it. */
    private val now = flow {
        while (true) {
            emit(sharing.serverNowMillis())
            delay(TICK_MILLIS)
        }
    }.distinctUntilChanged()

    val state: StateFlow<LiveUiState> = combine(sharing.state, now, local) { share, now, local ->
        present(share, now, local)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LiveUiState())

    init {
        // The notification's Stop sharing: show the question here, once.
        viewModelScope.launch {
            sharing.stopConfirmationRequested.collect { requested ->
                if (requested) {
                    if (sharing.state.value is ShareState.Live) local.update { it.copy(confirmingStop = true) }
                    sharing.consumeStopConfirmation()
                }
            }
        }
        // A pending precision change is done once the session shows it, or the next ping applied it.
        viewModelScope.launch {
            sharing.state.collect { share ->
                val session = (share as? ShareState.Live)?.session ?: return@collect
                local.update { l -> if (l.requestedPrecision == session.effectivePrecision) l.copy(requestedPrecision = null) else l }
            }
        }
    }

    fun onPrecisionChange(precision: Precision) {
        val current = state.value.precisionShown
        if (precision == current) return
        if (precision == Precision.PRECISE && !permissions.state.value.preciseLocation) {
            send(LiveEvent.RequestPrecise)
            return
        }
        applyPrecision(precision)
    }

    /** The system's answer to the precise request: switch to Precise once it's given. */
    fun onPreciseResult(result: Map<String, Boolean>) {
        permissions.onLocationRequestResult(result)
        if (permissions.state.value.preciseLocation) applyPrecision(Precision.PRECISE)
    }

    private fun applyPrecision(precision: Precision) {
        local.update { it.copy(requestedPrecision = precision) }
        viewModelScope.launch {
            if (sharing.setPrecision(precision) is UpdateShareResult.Failed) {
                local.update { it.copy(requestedPrecision = null) }
                send(LiveEvent.UpdateFailed)
            }
        }
    }

    fun onStopChange(choice: StopChoice) {
        viewModelScope.launch {
            if (sharing.changeStop(choice) is UpdateShareResult.Failed) send(LiveEvent.UpdateFailed)
        }
    }

    /** Stop sharing: always asks first. */
    fun onStopTapped() {
        local.update { it.copy(confirmingStop = true) }
    }

    fun onStopCancelled() {
        local.update { it.copy(confirmingStop = false) }
    }

    /** Stop, confirmed. A double tap lands here twice before the dialog closes: only the first counts. */
    fun onStopConfirmed() {
        if (local.value.stopping || !local.value.confirmingStop) return
        local.update { it.copy(confirmingStop = false, stopping = true) }
        viewModelScope.launch {
            // Instant, even offline: the share turns Ended and the app moves on to the ended screen.
            if (sharing.stop() == null) local.update { it.copy(stopping = false) }
        }
    }

    /** Turn on alerts: the system's notification dialog. */
    fun onAlertsYes() {
        local.update { it.copy(askAlerts = false) }
        permissions.notificationPermissionToRequest?.let { send(LiveEvent.RequestNotifications(it)) }
    }

    fun onAlertsNotNow() {
        local.update { it.copy(askAlerts = false) }
    }

    fun onNotificationResult(granted: Boolean) {
        permissions.onNotificationRequestResult(granted)
    }

    /** Ask for notifications right after the first link goes out, when the system would show its dialog. */
    private fun canAskAlerts(): Boolean =
        permissions.notificationPermissionToRequest != null && permissions.state.value.notifications == PermissionStatus.NotAsked

    private fun present(share: ShareState, now: Long, local: Local): LiveUiState {
        val live = share as? ShareState.Live ?: return LiveUiState(confirmingStop = false, stopping = local.stopping)
        val session = live.session
        val upload = live.upload
        val expiresAt = session?.expiresAtMillis ?: live.share.expiresAtMillis
        val precision = session?.precision ?: upload.precision
        val target = session?.effectivePrecision ?: upload.precision
        val stop = session?.let(StopChoices::ofSession) ?: StopChoice.AtLimit
        return LiveUiState(
            live = true,
            audience = Audience.of(live.share.viewerName),
            look = session?.sharer?.let { MascotLook(it.mascotId, it.mascotColor, it.mascotAccessory).normalized() } ?: MascotLook(),
            nowMillis = now,
            startedAtMillis = session?.startedAtMillis ?: live.share.startedAtMillis,
            expiresAtMillis = expiresAt,
            endsAtMillis = session?.endsAtMillis ?: expiresAt,
            followsCall = session?.stopRule == StopRule.CALL,
            stop = stop,
            stopOptions = StopChoices.whileSharing(now, expiresAt),
            limitSoon = session?.limitSoon(now) ?: false,
            openedAtMillis = session?.firstViewedAtMillis,
            signal = when {
                upload.offline -> SharerSignal.Offline
                upload.signal == GpsSignal.NoSignal -> SharerSignal.NoGps
                else -> SharerSignal.Live
            },
            intervalSeconds = upload.intervalSeconds,
            precision = precision,
            precisionShown = local.requestedPrecision ?: target,
            point = upload.lastPoint,
            confirmingStop = local.confirmingStop,
            stopping = local.stopping,
            askAlerts = local.askAlerts,
            link = ShareSheetContent(live.share.linkUrl, session?.sharer?.name?.takeIf { it.isNotBlank() } ?: profileName()),
        )
    }

    private fun send(event: LiveEvent) {
        viewModelScope.launch { _events.send(event) }
    }

    companion object {
        const val TICK_MILLIS = 1_000L

        fun factory(container: AppContainer, askAlerts: Boolean) = viewModelFactory {
            initializer {
                LiveViewModel(container.sharing, container.locationPermissions, askAlerts) {
                    (container.profiles.profile.value as? ProfileState.Ready)?.profile?.name.orEmpty()
                }
            }
        }
    }
}
