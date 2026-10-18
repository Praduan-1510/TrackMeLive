package live.trackme.app.ui.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.disabled
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import kotlinx.coroutines.launch
import live.trackme.app.BuildConfig
import live.trackme.app.R
import live.trackme.app.data.settings.Appearance
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.ButtonVariant
import live.trackme.app.ui.components.LayoutDefaults
import live.trackme.app.ui.components.ListFootnote
import live.trackme.app.ui.components.ListGroup
import live.trackme.app.ui.components.ListRow
import live.trackme.app.ui.components.PreviewTheme
import live.trackme.app.ui.components.RadioRow
import live.trackme.app.ui.components.RowTone
import live.trackme.app.ui.components.ScreenPreviews
import live.trackme.app.ui.components.SectionHeader
import live.trackme.app.ui.components.SegmentedControl
import live.trackme.app.ui.components.StackedRow
import live.trackme.app.ui.components.SwitchRow
import live.trackme.app.ui.components.TmlButton
import live.trackme.app.ui.components.TmlLargeTopAppBar
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.DefaultStop
import live.trackme.schema.Precision

/**
 * Settings (prototype › viewSettings, Android): Sharing, Live Together, Alerts, Appearance,
 * Permissions, Your data and About, as grouped lists under a large app bar that collapses as the
 * list scrolls. Stateless: it shows [state] and reports every change through [onEvent]. The
 * Default stop time sheet and the Delete your account? dialog are its own UI state.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: SettingsUiState,
    onEvent: (SettingsEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior(rememberTopAppBarState())
    var showStopSheet by rememberSaveable { mutableStateOf(false) }
    var showDeleteDialog by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        modifier = modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        containerColor = TmlTheme.colors.ground,
        topBar = { TmlLargeTopAppBar(title = stringResource(R.string.settings_title), scrollBehavior = scrollBehavior) },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding)
                .verticalScroll(rememberScrollState()),
            contentAlignment = Alignment.TopCenter,
        ) {
            SettingsContent(
                state = state,
                onEvent = onEvent,
                onDefaultStop = { showStopSheet = true },
                onDeleteAccount = { showDeleteDialog = true },
                modifier = Modifier
                    .widthIn(max = LayoutDefaults.ContentMaxWidth)
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
                    .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, bottom = TmlSpacing.Space8),
            )
        }
    }

    if (showStopSheet) {
        DefaultStopSheet(
            selected = state.defaultStop,
            onPick = { onEvent(SettingsEvent.DefaultStopChanged(it)) },
            onDismiss = { showStopSheet = false },
        )
    }
    if (showDeleteDialog) {
        DeleteAccountDialog(
            enabled = !state.deleting,
            onConfirm = {
                // A double tap lands here twice before the dialog closes: only the first one counts.
                if (showDeleteDialog) {
                    showDeleteDialog = false
                    onEvent(SettingsEvent.DeleteAccountConfirmed)
                }
            },
            onDismiss = { showDeleteDialog = false },
        )
    }
}

/**
 * "Can't update your profile right now.": quiet (ink-secondary supporting text, no color, no action),
 * since the app keeps retrying by itself, and announced once, politely.
 */
@Composable
private fun UpdatesUnavailableNote() {
    Text(
        text = stringResource(R.string.settings_updates_unavailable),
        style = AppType.supporting,
        color = TmlTheme.colors.inkSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = TmlSpacing.Space2, bottom = TmlSpacing.Space2)
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
private fun SettingsContent(
    state: SettingsUiState,
    onEvent: (SettingsEvent) -> Unit,
    onDefaultStop: () -> Unit,
    onDeleteAccount: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        if (state.updatesUnavailable) UpdatesUnavailableNote()
        SectionHeader(stringResource(R.string.settings_section_sharing), first = true)
        ListGroup {
            SwitchRow(
                headline = stringResource(R.string.settings_offer_on_call),
                supporting = stringResource(R.string.settings_offer_on_call_detail),
                checked = state.offerOnCall,
                onCheckedChange = { onEvent(SettingsEvent.OfferOnCallChanged(it)) },
            )
            StackedRow(headline = stringResource(R.string.settings_location_detail)) {
                val options = Precision.entries
                SegmentedControl(
                    labels = options.map { stringResource(it.labelRes()) },
                    selectedIndex = options.indexOf(state.precision),
                    onSelect = { onEvent(SettingsEvent.PrecisionChanged(options[it])) },
                )
            }
            ListRow(
                headline = stringResource(R.string.settings_default_stop),
                supporting = stringResource(state.defaultStop.labelRes()),
                onClick = onDefaultStop,
            )
        }

        SectionHeader(stringResource(R.string.settings_section_live_together))
        ListGroup {
            SwitchRow(
                headline = stringResource(R.string.settings_share_back),
                supporting = stringResource(R.string.settings_share_back_detail),
                checked = state.shareBack,
                onCheckedChange = { onEvent(SettingsEvent.ShareBackChanged(it)) },
            )
        }

        SectionHeader(stringResource(R.string.settings_section_alerts))
        ListGroup {
            SwitchRow(
                headline = stringResource(R.string.settings_alert_link_opened),
                checked = state.alertLinkOpened,
                onCheckedChange = { onEvent(SettingsEvent.AlertLinkOpenedChanged(it)) },
            )
            SwitchRow(
                headline = stringResource(R.string.settings_alert_call_ended),
                checked = state.alertCallEnded,
                onCheckedChange = { onEvent(SettingsEvent.AlertCallEndedChanged(it)) },
            )
            SwitchRow(
                headline = stringResource(R.string.settings_alert_expiry),
                checked = state.alertExpiry,
                onCheckedChange = { onEvent(SettingsEvent.AlertExpiryChanged(it)) },
            )
        }

        SectionHeader(stringResource(R.string.settings_section_appearance))
        ListGroup {
            StackedRow(headline = null) {
                val options = Appearance.entries
                SegmentedControl(
                    labels = options.map { stringResource(it.labelRes()) },
                    selectedIndex = options.indexOf(state.appearance),
                    onSelect = { onEvent(SettingsEvent.AppearanceChanged(options[it])) },
                )
            }
        }

        SectionHeader(stringResource(R.string.settings_section_permissions))
        PermissionRows(state.permissions, onEvent)
        ListFootnote(stringResource(R.string.settings_background_note), Modifier.padding(top = TmlSpacing.Space1))
        ListFootnote(stringResource(R.string.settings_pip_note))

        SectionHeader(stringResource(R.string.settings_section_your_data))
        ListGroup {
            val deletingLabel = stringResource(R.string.settings_deleting)
            ListRow(
                headline = stringResource(R.string.settings_delete_account),
                leadingIcon = R.drawable.ic_delete,
                tone = RowTone.Danger,
                supporting = if (state.deleting) deletingLabel else null,
                // While deleting: no second tap, the progress shown, and TalkBack hears it's busy.
                onClick = if (state.deleting) null else onDeleteAccount,
                trailing = if (state.deleting) {
                    { CircularProgressIndicator(Modifier.size(20.dp), color = TmlTheme.colors.flareText, strokeWidth = 2.dp) }
                } else {
                    null
                },
                modifier = if (state.deleting) Modifier.semantics { disabled() } else Modifier,
            )
        }
        ListFootnote(stringResource(R.string.settings_retention_note), Modifier.padding(top = TmlSpacing.Space1))

        SectionHeader(stringResource(R.string.settings_section_about))
        ListGroup {
            ListRow(
                headline = stringResource(R.string.settings_version_label),
                trailing = { Text(BuildConfig.VERSION_NAME, style = AppType.listItem, color = TmlTheme.colors.inkSecondary) },
            )
        }
        ListFootnote(stringResource(R.string.settings_licenses_note), Modifier.padding(top = TmlSpacing.Space1))
    }
}

/** Location, Phone and Notifications, each with where it stands in words. Location and Notifications open their pages. */
@Composable
private fun PermissionRows(p: PermissionsUiState, onEvent: (SettingsEvent) -> Unit) {
    val location = when (p.location) {
        PermissionStatus.NotAsked -> stringResource(R.string.settings_permission_not_set)
        PermissionStatus.Denied -> stringResource(R.string.settings_location_denied)
        PermissionStatus.Allowed -> stringResource(R.string.settings_location_while_using).let {
            if (p.preciseLocation) it else stringResource(R.string.settings_location_approximate, it)
        }
    }
    val phone = stringResource(
        R.string.settings_phone_detail,
        stringResource(if (p.phone == PermissionStatus.Allowed) R.string.settings_phone_allowed else R.string.settings_phone_not_allowed),
    )
    val notifications = when (p.notifications) {
        PermissionStatus.NotAsked -> stringResource(R.string.settings_permission_not_set)
        PermissionStatus.Allowed -> stringResource(R.string.settings_notifications_allowed)
        PermissionStatus.Denied -> stringResource(R.string.settings_notifications_off)
    }
    ListGroup {
        ListRow(
            headline = stringResource(R.string.settings_permission_location),
            supporting = location,
            leadingIcon = R.drawable.ic_location_on,
            onClick = { onEvent(SettingsEvent.LocationPermissionTapped) },
        )
        ListRow(
            headline = stringResource(R.string.settings_permission_phone),
            supporting = phone,
            leadingIcon = R.drawable.ic_call,
        )
        ListRow(
            headline = stringResource(R.string.settings_permission_notifications),
            supporting = notifications,
            leadingIcon = R.drawable.ic_notifications,
            onClick = { onEvent(SettingsEvent.NotificationsPermissionTapped) },
        )
    }
}

/** Default stop time: a modal bottom sheet of radio choices (prototype › timer sheet, for the default). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DefaultStopSheet(selected: DefaultStop, onPick: (DefaultStop) -> Unit, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val title = stringResource(R.string.settings_default_stop)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(Modifier.padding(bottom = TmlSpacing.Space6)) {
            Text(
                text = title,
                style = TmlTheme.type.title2,
                color = TmlTheme.colors.ink,
                modifier = Modifier
                    .padding(horizontal = TmlSpacing.Space6, vertical = TmlSpacing.Space2)
                    .semantics { heading() },
            )
            Column(Modifier.selectableGroup().padding(horizontal = TmlSpacing.Space2)) {
                DefaultStop.entries.forEach { stop ->
                    RadioRow(
                        text = stringResource(stop.labelRes()),
                        selected = stop == selected,
                        onClick = {
                            onPick(stop)
                            scope.launch { sheetState.hide() }.invokeOnCompletion { if (!sheetState.isVisible) onDismiss() }
                        },
                    )
                }
            }
            Text(
                text = stringResource(R.string.settings_stop_sheet_note),
                style = TmlTheme.type.footnote,
                color = TmlTheme.colors.inkSecondary,
                modifier = Modifier.padding(horizontal = TmlSpacing.Space6, vertical = TmlSpacing.Space2),
            )
        }
    }
}

/** The Material 3 confirm dialog. Cancel is first and takes the dismiss slot; Delete is flare text. */
@Composable
private fun DeleteAccountDialog(enabled: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val c = TmlTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(painterResource(R.drawable.ic_delete), contentDescription = null) },
        title = { Text(stringResource(R.string.settings_delete_title), textAlign = TextAlign.Center) },
        text = { Text(stringResource(R.string.settings_delete_body), textAlign = TextAlign.Center) },
        confirmButton = {
            TmlButton(
                text = stringResource(R.string.settings_delete_confirm),
                onClick = onConfirm,
                variant = ButtonVariant.PlainDanger,
                enabled = enabled,
            )
        },
        dismissButton = {
            TmlButton(text = stringResource(R.string.settings_delete_cancel), onClick = onDismiss, variant = ButtonVariant.Plain)
        },
        iconContentColor = c.inkSecondary,
        titleContentColor = c.ink,
        textContentColor = c.inkSecondary,
    )
}

@StringRes
private fun Precision.labelRes(): Int = when (this) {
    Precision.PRECISE -> R.string.settings_precise
    Precision.APPROXIMATE -> R.string.settings_approximate
}

@StringRes
internal fun DefaultStop.labelRes(): Int = when (this) {
    DefaultStop.CALL -> R.string.settings_stop_call
    DefaultStop.MINUTES_15 -> R.string.settings_stop_15
    DefaultStop.MINUTES_30 -> R.string.settings_stop_30
    DefaultStop.MINUTES_60 -> R.string.settings_stop_60
}

@StringRes
private fun Appearance.labelRes(): Int = when (this) {
    Appearance.System -> R.string.settings_appearance_system
    Appearance.Light -> R.string.settings_appearance_light
    Appearance.Dark -> R.string.settings_appearance_dark
}

@ScreenPreviews
@Composable
private fun SettingsPreview() {
    PreviewTheme {
        SettingsScreen(
            state = SettingsUiState(permissions = PermissionsUiState(location = PermissionStatus.Allowed, preciseLocation = false)),
            onEvent = {},
        )
    }
}
