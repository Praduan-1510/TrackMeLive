package live.trackme.app.ui.routes

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.platform.LocalContext
import live.trackme.app.di.appContainer
import live.trackme.app.R
import live.trackme.app.ui.mascot.MascotPickerMode
import live.trackme.app.ui.mascot.MascotPickerScreen
import live.trackme.app.ui.navigation.TmlSnackbarHost

/** A new account's first mascot pick: Continue saves it and opens Home. */
@Composable
fun MascotSetupRoute(
    vm: MascotViewModel = viewModel(factory = MascotViewModel.factory(LocalContext.current.appContainer, MascotPickerMode.Setup)),
) {
    MascotPicker(vm, MascotPickerMode.Setup)
}

/**
 * The Mascot tab: Save keeps the pick, and a snackbar confirms it. The snackbar lives in the picker's
 * own Scaffold, so it sits above the pinned Save button rather than over it.
 */
@Composable
fun MascotTabRoute(
    vm: MascotViewModel = viewModel(factory = MascotViewModel.factory(LocalContext.current.appContainer, MascotPickerMode.Tab)),
) {
    val snackbar = remember { SnackbarHostState() }
    val saved = stringResource(R.string.route_mascot_saved)
    LaunchedEffect(vm) {
        vm.eventFlow.collect { snackbar.showSnackbar(saved) }
    }
    MascotPicker(vm, MascotPickerMode.Tab, snackbarHost = { TmlSnackbarHost(snackbar) })
}

@Composable
private fun MascotPicker(vm: MascotViewModel, mode: MascotPickerMode, snackbarHost: @Composable () -> Unit = {}) {
    val state by vm.state.collectAsStateWithLifecycle()
    MascotPickerScreen(
        initial = state.initial,
        mode = mode,
        onSave = vm::save,
        saving = state.saving,
        errorMessage = if (state.saveFailed) stringResource(R.string.route_mascot_save_failed) else null,
        snackbarHost = snackbarHost,
    )
}
