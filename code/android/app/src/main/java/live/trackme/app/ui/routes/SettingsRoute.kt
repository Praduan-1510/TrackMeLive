package live.trackme.app.ui.routes

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.platform.LocalContext
import live.trackme.app.di.appContainer
import live.trackme.app.R
import live.trackme.app.ui.settings.SettingsScreen

/** The Settings tab, wired to [SettingsViewModel]; save and delete failures show in the snackbar. */
@Composable
fun SettingsRoute(
    snackbar: SnackbarHostState,
    vm: SettingsViewModel = viewModel(factory = SettingsViewModel.factory(LocalContext.current.appContainer)),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val saveFailed = stringResource(R.string.route_settings_save_failed)
    val deleteOffline = stringResource(R.string.route_delete_offline)
    val deleteFailed = stringResource(R.string.route_delete_failed)
    LaunchedEffect(vm) {
        vm.messageFlow.collect { message ->
            snackbar.showSnackbar(
                when (message) {
                    SettingsMessage.SaveFailed -> saveFailed
                    is SettingsMessage.DeleteFailed -> if (message.offline) deleteOffline else deleteFailed
                },
            )
        }
    }
    SettingsScreen(state = state, onEvent = vm::onEvent)
}
