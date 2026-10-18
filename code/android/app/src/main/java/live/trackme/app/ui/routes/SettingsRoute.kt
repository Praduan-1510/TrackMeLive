package live.trackme.app.ui.routes

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import live.trackme.app.R
import live.trackme.app.di.appContainer
import live.trackme.app.ui.permission.ExplainerSheet
import live.trackme.app.ui.permission.rememberLocationGate
import live.trackme.app.ui.permission.startSettings
import live.trackme.app.ui.settings.SettingsScreen

/**
 * The Settings tab, wired to [SettingsViewModel]; save and delete failures show in the snackbar. The
 * Permissions rows ask the first time (our explainer, then the system dialog) and otherwise open the
 * system Settings page, the way back from a refusal.
 */
@Composable
fun SettingsRoute(
    snackbar: SnackbarHostState,
    vm: SettingsViewModel = viewModel(factory = SettingsViewModel.factory(LocalContext.current.appContainer)),
) {
    val context = LocalContext.current
    val state by vm.state.collectAsStateWithLifecycle()
    val saveFailed = stringResource(R.string.route_settings_save_failed)
    val deleteOffline = stringResource(R.string.route_delete_offline)
    val deleteFailed = stringResource(R.string.route_delete_failed)
    val gate = rememberLocationGate(onGranted = {})
    var askNotifications by rememberSaveable { mutableStateOf<String?>(null) }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission(), vm::onNotificationResult)
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
    LaunchedEffect(vm) {
        vm.permissionActions.collect { action ->
            when (action) {
                PermissionAction.AskLocation -> gate.start()
                is PermissionAction.AskNotifications -> askNotifications = action.permission
                is PermissionAction.OpenSettings -> context.startSettings(action.intent)
            }
        }
    }
    LifecycleResumeEffect(vm) {
        vm.onResume()
        onPauseOrDispose { }
    }
    SettingsScreen(state = state, onEvent = vm::onEvent)
    askNotifications?.let { permission ->
        ExplainerSheet(
            icon = R.drawable.ic_notifications_active_filled,
            title = stringResource(R.string.perm_alerts_title),
            body = stringResource(R.string.perm_alerts_body),
            confirm = stringResource(R.string.perm_alerts_yes),
            dismiss = stringResource(R.string.perm_not_now),
            onConfirm = {
                askNotifications = null
                notifications.launch(permission)
            },
            onDismiss = { askNotifications = null },
        )
    }
}
