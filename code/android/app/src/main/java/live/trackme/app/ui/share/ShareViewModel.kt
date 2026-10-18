package live.trackme.app.ui.share

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import live.trackme.app.Names
import live.trackme.app.data.location.LocationPermissions
import live.trackme.app.data.location.PermissionsState
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.sharing.CreateShareResult
import live.trackme.app.data.sharing.DiscardShareResult
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.SharingFailure
import live.trackme.app.data.sharing.SharingRepository
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.di.AppContainer
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes

/** Why a share didn't start, in the words under the Share button. */
enum class ShareError { Network, AlreadySharing, Location, Other }

/** The share screen (prototype › viewShare): the person's choices before the link goes out. */
@Immutable
data class ShareUiState(
    /** The person's mascot, on the preview map. */
    val look: MascotLook = MascotLook(),
    /** The person's own name, for the share sheet's preview ("Alex · Live location"). */
    val sharerName: String = "",
    val stop: StopChoice = StopChoice.After(StopMinutes.MINUTES_30),
    val stopOptions: List<StopChoice> = StopChoices.beforeSharing,
    val precision: Precision = Precision.PRECISE,
    /** False when the phone gives the app only approximate location: Precise then asks the system first. */
    val preciseAllowed: Boolean = true,
    /** The name can't be used (no letter or number); shown under the field. */
    val nameError: Boolean = false,
    /** Creating the session, waiting on the share sheet, or taking an unsent link back. */
    val busy: Boolean = false,
    val error: ShareError? = null,
    /** Open the share sheet with this (once): the session exists and its link is ready. */
    val sheet: ShareSheetContent? = null,
)

/** What the share screen asks its host to do. */
sealed interface ShareEvent {
    /** The link went out: on to the live screen. */
    data object Shared : ShareEvent

    /** Ask the system for precise location (it shows its "Change to precise location" dialog). */
    data object RequestPrecise : ShareEvent
}

/**
 * The share screen: who it's for, when it stops and how precise, then Share (FSD §4 Manual sharing,
 * Live map link, Who it's for, Location detail, Stop rule).
 *
 * Share creates the session, then the share sheet opens with its link. If the sheet closes without a
 * choice, the session is taken back before anyone can see it and the screen stays as it was; Copy
 * counts as sent. Every Sprint 2 share is manual: no call, so no call stop rule and no share back.
 *
 * The name field's text is Compose state here, written synchronously from each keystroke. It starts
 * with the last name used (users.last_viewer_name), unless the person already typed.
 */
class ShareViewModel(
    private val sharing: SharingRepository,
    private val permissions: LocationPermissions,
    private val profiles: ProfileRepository,
    private val autoShare: Boolean = false,
) : ViewModel() {

    var viewerName by mutableStateOf("")
        private set

    private var nameEdited = false
    private var wantPrecise = false

    private val _state = MutableStateFlow(ShareUiState(preciseAllowed = permissions.state.value.preciseLocation))
    val state: StateFlow<ShareUiState> = _state.asStateFlow()

    private val _events = Channel<ShareEvent>(Channel.BUFFERED)
    val events: Flow<ShareEvent> = _events.receiveAsFlow()

    init {
        viewModelScope.launch {
            // The choices start from the profile once: the last name used, and Settings' defaults.
            val profile = profiles.profile.filterIsInstance<ProfileState.Ready>().first().profile
            val precise = permissions.state.value.preciseLocation
            if (!nameEdited) viewerName = Names.limitInput(profile.lastViewerName.orEmpty())
            _state.update {
                it.copy(
                    look = MascotLook(profile.mascotId, profile.mascotColor, profile.mascotAccessory).normalized(),
                    sharerName = Names.tidy(profile.name),
                    stop = StopChoices.fromDefault(profile.settings.defaultStop),
                    // With precise location off for the app, every share is approximate.
                    precision = if (precise) profile.settings.precision else Precision.APPROXIMATE,
                )
            }
            if (autoShare) share()
        }
        viewModelScope.launch {
            permissions.state.collect(::onPermissions)
        }
    }

    fun onViewerNameChange(raw: String) {
        nameEdited = true
        viewerName = Names.limitInput(raw)
        if (_state.value.nameError) _state.update { it.copy(nameError = false) }
    }

    fun clearViewerName() = onViewerNameChange("")

    fun onStopChange(choice: StopChoice) {
        _state.update { it.copy(stop = choice) }
    }

    /** Precise needs the system's precise location: ask for it first, and switch once it's given. */
    fun onPrecisionChange(precision: Precision) {
        if (precision == Precision.PRECISE && !permissions.state.value.preciseLocation) {
            wantPrecise = true
            send(ShareEvent.RequestPrecise)
            return
        }
        _state.update { it.copy(precision = precision) }
    }

    /** The system's answer to the precise request. */
    fun onPreciseResult(result: Map<String, Boolean>) {
        permissions.onLocationRequestResult(result)
        val precise = permissions.state.value.preciseLocation
        if (wantPrecise && precise) _state.update { it.copy(preciseAllowed = true, precision = Precision.PRECISE) }
        wantPrecise = false
    }

    /** Share live location: create the session, then the share sheet opens with the link. */
    fun share() {
        val s = _state.value
        if (s.busy || s.sheet != null) return
        val name = Names.tidy(viewerName).takeIf { it.isNotEmpty() }
        if (name != null && !Names.isValid(name)) {
            _state.update { it.copy(nameError = true) }
            return
        }
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val request = ShareRequest(stop = s.stop, precision = s.precision, shareBackAllowed = false, callId = null, viewerName = name)
            when (val result = sharing.createSession(request)) {
                is CreateShareResult.Created -> _state.update {
                    it.copy(sheet = ShareSheetContent(result.share.linkUrl, it.sharerName))
                }
                is CreateShareResult.AlreadySharing -> fail(ShareError.AlreadySharing)
                is CreateShareResult.Failed -> fail(errorFor(result.reason))
            }
        }
    }

    /** The share sheet is on screen: it opens once, even if the screen is recreated meanwhile. */
    fun onSheetOpened() {
        _state.update { it.copy(sheet = null) }
    }

    /**
     * The share sheet closed. Sent: on to the live screen. Closed without a choice: the session is
     * taken back and the screen stays, unless the link was opened in the meantime (it then keeps going).
     */
    fun onSheetClosed(outcome: ShareSheetOutcome) {
        if (outcome == ShareSheetOutcome.Sent) {
            _state.update { it.copy(busy = false) }
            send(ShareEvent.Shared)
            return
        }
        viewModelScope.launch {
            when (sharing.discard()) {
                DiscardShareResult.LinkOpened -> send(ShareEvent.Shared)
                // Failed too: the pings have stopped and nothing is shared; the screen stays.
                DiscardShareResult.Discarded, is DiscardShareResult.Failed -> Unit
            }
            _state.update { it.copy(busy = false) }
        }
    }

    private fun onPermissions(p: PermissionsState) {
        _state.update {
            // Precise turned off in Settings: shares are approximate from now on.
            if (p.preciseLocation) it.copy(preciseAllowed = true) else it.copy(preciseAllowed = false, precision = Precision.APPROXIMATE)
        }
    }

    private fun fail(error: ShareError) {
        _state.update { it.copy(busy = false, error = error) }
    }

    private fun send(event: ShareEvent) {
        viewModelScope.launch { _events.send(event) }
    }

    companion object {
        fun errorFor(reason: SharingFailure): ShareError = when (reason) {
            SharingFailure.Network -> ShareError.Network
            SharingFailure.LocationPermission -> ShareError.Location
            else -> ShareError.Other
        }

        fun factory(container: AppContainer, autoShare: Boolean) = viewModelFactory {
            initializer { ShareViewModel(container.sharing, container.locationPermissions, container.profiles, autoShare) }
        }
    }
}
