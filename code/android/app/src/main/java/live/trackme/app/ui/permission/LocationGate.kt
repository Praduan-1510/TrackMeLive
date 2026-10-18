package live.trackme.app.ui.permission

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import live.trackme.app.R
import live.trackme.app.data.location.LocationPermissions
import live.trackme.app.data.location.PermissionStatus
import live.trackme.app.di.AppContainer
import live.trackme.app.di.appContainer

/** What the location gate shows over the screen. */
enum class GatePrompt {
    None,

    /** "Allow location to share", before the system dialog (first time only). */
    Explainer,

    /** "Location is off for Track Me Live": refused; Open settings goes to the app's page. */
    LocationOff,

    /** "Location is off on this phone": the system Location switch is off. */
    ServicesOff,
}

/** What the gate asks its host to do. */
sealed interface GateEvent {
    /** Show the system's location dialog (fine and coarse together). */
    data object RequestLocation : GateEvent

    /** Open system Settings with [intent]. */
    data class OpenSettings(val intent: Intent) : GateEvent

    /** Location is allowed and on: carry on to the share screen. */
    data object Granted : GateEvent
}

/**
 * Location, asked on the first share and never at install, with our explanation first (FSD §8;
 * prototype › openShare, locPre, locSys, locOff):
 * - Not asked yet: the explainer, then the system dialog.
 * - Refused but askable: straight to the system dialog (the person has seen the explainer).
 * - Refused for good, or refused in the dialog just now: "Location is off for Track Me Live" with Open
 *   settings. Coming back from Settings with location allowed carries on by itself.
 * - Allowed but the phone's Location is off: the same, for the system Location setting.
 * "While using the app" is all sharing needs; the app never asks for background location.
 */
class LocationGateViewModel(private val permissions: LocationPermissions) : ViewModel() {
    private val _prompt = MutableStateFlow(GatePrompt.None)
    val prompt: StateFlow<GatePrompt> = _prompt.asStateFlow()

    private val _events = Channel<GateEvent>(Channel.BUFFERED)
    val events: Flow<GateEvent> = _events.receiveAsFlow()

    /** True after Open settings, until the person comes back to the app. */
    private var inSettings = false

    val locationPermissions: Array<String> get() = permissions.locationPermissionsToRequest

    /** The person asked to share: carry on, or ask first. */
    fun start() {
        permissions.refresh()
        val s = permissions.state.value
        when (s.location) {
            PermissionStatus.Granted -> proceedIfOn(s.locationServicesOn)
            PermissionStatus.NotAsked -> _prompt.value = GatePrompt.Explainer
            PermissionStatus.Denied -> send(GateEvent.RequestLocation)
            PermissionStatus.DeniedForever -> _prompt.value = GatePrompt.LocationOff
        }
    }

    /** The explainer's Continue. */
    fun onContinue() {
        _prompt.value = GatePrompt.None
        send(GateEvent.RequestLocation)
    }

    /** Not now, or the prompt was swiped or tapped away. Nothing is asked and nothing is shared. */
    fun onNotNow() {
        _prompt.value = GatePrompt.None
    }

    /** The system dialog's answer. */
    fun onResult(result: Map<String, Boolean>) {
        permissions.onLocationRequestResult(result)
        val s = permissions.state.value
        if (s.location == PermissionStatus.Granted) proceedIfOn(s.locationServicesOn) else _prompt.value = GatePrompt.LocationOff
    }

    /** Open settings, from either "Location is off" dialog. */
    fun onOpenSettings() {
        val intent = if (_prompt.value == GatePrompt.ServicesOff) permissions.locationServicesIntent() else permissions.appSettingsIntent()
        _prompt.value = GatePrompt.None
        inSettings = true
        send(GateEvent.OpenSettings(intent))
    }

    /** The app is back in front: after Settings, carry on if location is now allowed and on. */
    fun onResume() {
        if (!inSettings) return
        inSettings = false
        permissions.refresh()
        val s = permissions.state.value
        if (s.location == PermissionStatus.Granted && s.locationServicesOn) send(GateEvent.Granted)
    }

    private fun proceedIfOn(servicesOn: Boolean) {
        if (servicesOn) send(GateEvent.Granted) else _prompt.value = GatePrompt.ServicesOff
    }

    private fun send(event: GateEvent) {
        viewModelScope.launch { _events.send(event) }
    }

    companion object {
        fun factory(container: AppContainer) = viewModelFactory {
            initializer { LocationGateViewModel(container.locationPermissions) }
        }
    }
}

/** Starts the location gate: see [rememberLocationGate]. */
fun interface LocationGate {
    fun start()
}

/**
 * Hosts the location gate on this screen: its prompts, the system dialog and the trip to Settings.
 * Call [LocationGate.start] when the person asks to share; [onGranted] runs once location is allowed.
 */
@Composable
fun rememberLocationGate(onGranted: () -> Unit): LocationGate {
    val context = LocalContext.current
    val vm: LocationGateViewModel = viewModel(key = "locationGate", factory = LocationGateViewModel.factory(context.appContainer))
    val granted by rememberUpdatedState(onGranted)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.onResult(it) }
    LaunchedEffect(vm) {
        vm.events.collect { event ->
            when (event) {
                GateEvent.RequestLocation -> launcher.launch(vm.locationPermissions)
                is GateEvent.OpenSettings -> context.startSettings(event.intent)
                GateEvent.Granted -> granted()
            }
        }
    }
    LifecycleResumeEffect(vm) {
        vm.onResume()
        onPauseOrDispose { }
    }
    val prompt by vm.prompt.collectAsStateWithLifecycle()
    when (prompt) {
        GatePrompt.None -> Unit
        GatePrompt.Explainer -> ExplainerSheet(
            icon = R.drawable.ic_near_me_filled,
            title = stringResource(R.string.perm_location_title),
            body = stringResource(R.string.perm_location_body),
            confirm = stringResource(R.string.perm_continue),
            dismiss = stringResource(R.string.perm_not_now),
            onConfirm = vm::onContinue,
            onDismiss = vm::onNotNow,
        )
        GatePrompt.LocationOff -> IconDialog(
            icon = R.drawable.ic_location_off,
            title = stringResource(R.string.perm_location_off_title),
            body = stringResource(R.string.perm_location_off_body),
            confirm = stringResource(R.string.perm_open_settings),
            dismiss = stringResource(R.string.perm_not_now),
            onConfirm = vm::onOpenSettings,
            onDismiss = vm::onNotNow,
        )
        GatePrompt.ServicesOff -> IconDialog(
            icon = R.drawable.ic_location_off,
            title = stringResource(R.string.perm_services_off_title),
            body = stringResource(R.string.perm_services_off_body),
            confirm = stringResource(R.string.perm_open_settings),
            dismiss = stringResource(R.string.perm_not_now),
            onConfirm = vm::onOpenSettings,
            onDismiss = vm::onNotNow,
        )
    }
    return remember(vm) { LocationGate(vm::start) }
}

/** Opens a system Settings page; a phone without that page gets the app's own page, or nothing. */
fun Context.startSettings(intent: Intent) {
    try {
        startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // Some phones lack a specific Settings page; there is nothing better to open.
    }
}
