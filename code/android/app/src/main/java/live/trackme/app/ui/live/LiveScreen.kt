package live.trackme.app.ui.live

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import live.trackme.app.R
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.di.appContainer
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.BadgeKind
import live.trackme.app.ui.components.ButtonVariant
import live.trackme.app.ui.components.LayoutDefaults
import live.trackme.app.ui.components.MapSheet
import live.trackme.app.ui.components.MarkerState
import live.trackme.app.ui.components.Person
import live.trackme.app.ui.components.PersonRow
import live.trackme.app.ui.components.PersonRowDivider
import live.trackme.app.ui.components.SheetActions
import live.trackme.app.ui.components.StatTile
import live.trackme.app.ui.components.StatTileRow
import live.trackme.app.ui.components.StatusBadge
import live.trackme.app.ui.components.StatusTone
import live.trackme.app.ui.components.TmlButton
import live.trackme.app.ui.components.iconSizeFor
import live.trackme.app.ui.components.tabular
import live.trackme.app.ui.map.LiveMap
import live.trackme.app.ui.map.MapPerson
import live.trackme.app.ui.mascot.MascotImage
import live.trackme.app.ui.navigation.TmlSnackbarHost
import live.trackme.app.ui.permission.ExplainerSheet
import live.trackme.app.ui.share.PrecisionControl
import live.trackme.app.ui.share.ShareFormats
import live.trackme.app.ui.share.StopTimeSheet
import live.trackme.app.ui.share.rememberShareFormats
import live.trackme.app.ui.share.rememberShareSheet
import live.trackme.design.TmlRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.Precision

/**
 * The live screen's route: its view model, Send link again through the share sheet, the precise and
 * notification requests, and the snackbar for a change that didn't go through. [askAlerts] is true
 * right after the first link went out ("Know when Mom opens it").
 */
@Composable
fun LiveRoute(askAlerts: Boolean, onBack: () -> Unit) {
    val container = LocalContext.current.appContainer
    val vm: LiveViewModel = viewModel(factory = LiveViewModel.factory(container, askAlerts))
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val failed = stringResource(R.string.live_update_failed)
    val sheet = rememberShareSheet { }
    val precise = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions(), vm::onPreciseResult)
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission(), vm::onNotificationResult)
    LaunchedEffect(vm) {
        vm.events.collect { event ->
            when (event) {
                LiveEvent.RequestPrecise -> precise.launch(container.locationPermissions.locationPermissionsToRequest)
                is LiveEvent.RequestNotifications -> notifications.launch(event.permission)
                LiveEvent.UpdateFailed -> snackbar.showSnackbar(failed)
            }
        }
    }
    LiveScreen(
        state = state,
        snackbar = snackbar,
        actions = LiveActions(
            onBack = onBack,
            onPrecisionChange = vm::onPrecisionChange,
            onStopChange = vm::onStopChange,
            onSendAgain = { state.link?.let(sheet::open) },
            onStop = vm::onStopTapped,
            onStopConfirmed = vm::onStopConfirmed,
            onStopCancelled = vm::onStopCancelled,
            onAlertsYes = vm::onAlertsYes,
            onAlertsNotNow = vm::onAlertsNotNow,
        ),
    )
}

/** Everything the live screen can report. */
data class LiveActions(
    val onBack: () -> Unit = {},
    val onPrecisionChange: (Precision) -> Unit = {},
    val onStopChange: (StopChoice) -> Unit = {},
    val onSendAgain: () -> Unit = {},
    val onStop: () -> Unit = {},
    val onStopConfirmed: () -> Unit = {},
    val onStopCancelled: () -> Unit = {},
    val onAlertsYes: () -> Unit = {},
    val onAlertsNotNow: () -> Unit = {},
)

/**
 * Sharing live (prototype › viewLive, Android, a manual share): the map with the person's mascot, the
 * bar with when it stops, and the sheet: title and status, the three tiles, You and the viewer, the
 * Location control, Change timer and Send link again, and Stop sharing pinned at the bottom so it's
 * always reachable, at any text size. Stateless apart from the timer sheet being open.
 */
@Composable
fun LiveScreen(
    state: LiveUiState,
    actions: LiveActions,
    modifier: Modifier = Modifier,
    snackbar: SnackbarHostState = remember { SnackbarHostState() },
) {
    val c = TmlTheme.colors
    val formats = rememberShareFormats()
    val density = LocalDensity.current
    var barBottom by remember { mutableStateOf(0.dp) }
    var sheetHeight by remember { mutableStateOf(0.dp) }
    var showTimer by rememberSaveable { mutableStateOf(false) }

    BoxWithConstraints(modifier.fillMaxSize().background(c.mapLand)) {
        val sheetMax = maxHeight * SHEET_MAX_FRACTION
        // The map waits for the sheet's first measure, so the marker never starts under the sheet.
        if (state.live && sheetHeight > 0.dp) {
            LiveMap(
                sharer = sharerOnMap(state, formats),
                bandTop = barBottom,
                bandBottom = sheetHeight,
                mapLabel = stringResource(R.string.live_map),
            )
        }
        Column(Modifier.fillMaxSize()) {
            MapBar(
                state = state,
                formats = formats,
                onBack = actions.onBack,
                modifier = Modifier.onGloballyPositioned { barBottom = with(density) { (it.boundsInRoot().bottom).toDp() } },
            )
            Spacer(Modifier.weight(1f))
            if (state.live) {
                LiveSheet(
                    state = state,
                    formats = formats,
                    actions = actions,
                    onChangeTimer = { showTimer = true },
                    modifier = Modifier
                        .heightIn(max = sheetMax)
                        .onSizeChanged { sheetHeight = with(density) { it.height.toDp() } },
                )
            }
        }
        TmlSnackbarHost(
            snackbar,
            Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = sheetHeight + TmlSpacing.Space3),
        )
    }

    if (showTimer && state.live) {
        StopTimeSheet(
            options = state.stopOptions,
            selected = state.stop,
            expiresAtMillis = state.expiresAtMillis,
            onPick = actions.onStopChange,
            onDismiss = { showTimer = false },
        )
    }
    if (state.confirmingStop) StopDialog(state, actions)
    if (state.askAlerts && state.live) {
        val name = state.audience.inSentence
        ExplainerSheet(
            icon = R.drawable.ic_notifications_active_filled,
            title = if (name != null) stringResource(R.string.perm_alerts_title_named, name) else stringResource(R.string.perm_alerts_title),
            body = stringResource(R.string.perm_alerts_body),
            confirm = stringResource(R.string.perm_alerts_yes),
            dismiss = stringResource(R.string.perm_not_now),
            onConfirm = actions.onAlertsYes,
            onDismiss = actions.onAlertsNotNow,
        )
    }
}

/** The sharer on the map: "You" while live, "Last seen 9:41 pm" once quiet; the soft circle when approximate. */
@Composable
private fun sharerOnMap(state: LiveUiState, formats: ShareFormats): MapPerson {
    val quiet = state.signal != SharerSignal.Live && state.point != null
    val lastSeen = state.point?.let { formats.clock(it.recordedAtMillis) }.orEmpty()
    val approximate = state.precision == Precision.APPROXIMATE
    return MapPerson(
        person = Person.Sharer(state.look),
        lat = state.point?.lat,
        lng = state.point?.lng,
        label = if (quiet) stringResource(R.string.live_marker_last_seen, lastSeen) else stringResource(R.string.live_you),
        description = when {
            quiet -> stringResource(R.string.live_marker_you_last_seen, lastSeen)
            approximate -> stringResource(R.string.live_marker_you_approximate)
            else -> stringResource(R.string.live_marker_you)
        },
        state = when {
            quiet -> MarkerState.LastSeen
            approximate -> MarkerState.Approximate
            else -> MarkerState.Live
        },
        pingKey = state.point?.recordedAtMillis,
    )
}

/**
 * The bar over the map (prototype `.a-mapbar`): Back to Home, the mascot, "Sharing live" and when it
 * stops. A call's bar (On a call, Back to call) arrives with call sharing.
 */
@Composable
private fun MapBar(state: LiveUiState, formats: ShareFormats, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val shape = RoundedCornerShape(32.dp)
    Row(
        modifier
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 12.dp, end = 12.dp, top = TmlSpacing.Space2)
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(shape)
            .background(c.surface)
            .border(LayoutDefaults.Hairline, c.separator, shape)
            .padding(start = 4.dp, end = TmlSpacing.Space2, top = TmlSpacing.Space2, bottom = TmlSpacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
    ) {
        IconButton(
            onClick = onBack,
            colors = IconButtonDefaults.iconButtonColors(contentColor = c.ink),
            modifier = Modifier.size(48.dp),
        ) {
            Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.live_back))
        }
        if (state.live) {
            Box(
                Modifier
                    .size(BarAvatar)
                    .clip(CircleShape)
                    .background(c.surfaceRaised)
                    .border(2.dp, c.lamplight, CircleShape)
                    .clearAndSetSemantics { },
                contentAlignment = Alignment.Center,
            ) {
                MascotImage(look = state.look, size = BarAvatar - 6.dp, flatWhileLoading = true)
            }
            Column(Modifier.weight(1f).semantics(mergeDescendants = true) { }) {
                Text(stringResource(R.string.live_bar_title), style = BarTitle, color = c.ink)
                Text(
                    text = if (state.followsCall) {
                        stringResource(R.string.live_tile_stops_call_spoken)
                    } else {
                        stringResource(R.string.live_bar_stops, formats.clock(state.endsAtMillis))
                    },
                    style = BarSub.tabular(),
                    color = c.inkSecondary,
                )
            }
        }
    }
}

@Composable
private fun LiveSheet(
    state: LiveUiState,
    formats: ShareFormats,
    actions: LiveActions,
    onChangeTimer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val (badgeText, badgeSpoken, badgeKind) = when (state.signal) {
        SharerSignal.Live -> Triple(R.string.badge_live, R.string.badge_live_spoken, BadgeKind.Live)
        SharerSignal.NoGps -> Triple(R.string.badge_no_signal, R.string.badge_no_signal_spoken, BadgeKind.Neutral)
        SharerSignal.Offline -> Triple(R.string.badge_no_connection, R.string.badge_no_connection_spoken, BadgeKind.Neutral)
    }
    MapSheet(
        title = stringResource(R.string.live_title),
        modifier = modifier,
        badge = { StatusBadge(stringResource(badgeText), kind = badgeKind, spoken = stringResource(badgeSpoken)) },
        headExtra = {
            Text(
                text = subtitle(state, formats),
                style = TmlTheme.type.callout,
                color = TmlTheme.colors.inkSecondary,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            if (state.limitSoon) LimitLine(formats.clock(state.expiresAtMillis))
        },
        actions = {
            TmlButton(
                text = stringResource(R.string.live_stop),
                onClick = actions.onStop,
                variant = ButtonVariant.Danger,
                large = true,
                icon = R.drawable.ic_stop_circle_filled,
                loading = state.stopping,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        Tiles(state, formats)
        People(state, formats)
        PrecisionRow(state, actions.onPrecisionChange)
        SheetActions {
            TmlButton(
                text = stringResource(R.string.live_change_timer),
                onClick = onChangeTimer,
                variant = ButtonVariant.Tonal,
                icon = R.drawable.ic_timer,
                modifier = Modifier.heightIn(min = 48.dp),
            )
            TmlButton(
                text = stringResource(R.string.live_send_again),
                onClick = actions.onSendAgain,
                variant = ButtonVariant.Tonal,
                icon = R.drawable.ic_share,
                modifier = Modifier.heightIn(min = 48.dp),
            )
        }
    }
}

/** The line under the title (prototype `liveSub`). */
@Composable
private fun subtitle(state: LiveUiState, formats: ShareFormats): String {
    val name = state.audience.inSentence
    val seesLast = when {
        state.openedAtMillis != null && name != null -> stringResource(R.string.live_sees_last_named, name)
        state.openedAtMillis != null -> stringResource(R.string.live_sees_last)
        name != null -> stringResource(R.string.live_will_see_named, name)
        else -> stringResource(R.string.live_will_see)
    }
    return when {
        state.signal == SharerSignal.Offline -> stringResource(R.string.live_sub_offline, seesLast)
        state.signal == SharerSignal.NoGps -> stringResource(R.string.live_sub_no_gps, seesLast)
        state.openedAtMillis == null && name != null -> stringResource(R.string.live_sub_sent_named, name)
        state.openedAtMillis == null -> stringResource(R.string.live_sub_sent)
        name != null -> stringResource(R.string.live_sub_opened_named, name, formats.clock(state.openedAtMillis))
        else -> stringResource(R.string.live_sub_opened, formats.clock(state.openedAtMillis))
    }
}

/** "Sharing stops at 10:38 pm · 1-hour limit": quiet, and announced once when it appears. */
@Composable
private fun LimitLine(time: String) {
    val c = TmlTheme.colors
    Row(
        Modifier.padding(top = TmlSpacing.Space1).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
    ) {
        Icon(
            painterResource(R.drawable.ic_timer),
            contentDescription = null,
            tint = c.inkSecondary,
            modifier = Modifier.padding(top = 1.dp).size(iconSizeFor(18.dp, LimitStyle)),
        )
        Text(stringResource(R.string.live_limit, time), style = LimitStyle.tabular(), color = c.inkSecondary)
    }
}

/** Distance (not shared on a manual share), how long it's been, and when it stops; one phrase each. */
@Composable
private fun Tiles(state: LiveUiState, formats: ShareFormats) {
    val sharingFor = state.nowMillis - state.startedAtMillis
    StatTileRow {
        StatTile(
            value = stringResource(R.string.live_tile_not_shared_value),
            label = stringResource(R.string.live_tile_not_shared),
            spokenDescription = stringResource(R.string.live_tile_not_shared_spoken),
        )
        StatTile(
            value = formats.duration(sharingFor),
            label = stringResource(R.string.live_tile_sharing),
            spokenDescription = stringResource(R.string.live_tile_sharing_spoken, formats.durationSpoken(sharingFor)),
        )
        if (state.followsCall) {
            StatTile(
                value = stringResource(R.string.live_tile_stops_call),
                label = stringResource(R.string.live_tile_stops),
                spokenDescription = stringResource(R.string.live_tile_stops_call_spoken),
            )
        } else {
            val at = formats.clock(state.endsAtMillis)
            StatTile(
                value = at,
                label = stringResource(R.string.live_tile_stops),
                spokenDescription = stringResource(R.string.live_tile_stops_spoken, at),
            )
        }
    }
}

/** You and the person you shared with (prototype `.people`), and why they can't share back. */
@Composable
private fun People(state: LiveUiState, formats: ShareFormats) {
    val c = TmlTheme.colors
    val quiet = state.signal != SharerSignal.Live
    val precisionWord = stringResource(if (state.precision == Precision.PRECISE) R.string.live_precise else R.string.live_approximate)
    val seconds = ShareFormats.seconds(state.intervalSeconds)
    val youDetail = when (state.signal) {
        SharerSignal.Offline -> stringResource(R.string.live_no_connection)
        SharerSignal.NoGps -> stringResource(R.string.live_no_gps)
        SharerSignal.Live -> stringResource(R.string.live_you_detail, precisionWord, seconds)
    }
    val youSpokenDetail = when (state.signal) {
        SharerSignal.Live -> stringResource(
            R.string.live_you_detail_spoken,
            precisionWord,
            pluralStringResource(R.plurals.live_seconds_spoken, if (seconds == "1") 1 else 2, seconds),
        )
        else -> youDetail
    }
    val youStatus = stringResource(if (quiet) R.string.live_status_last_seen else R.string.live_status_live)
    val you = stringResource(R.string.live_you)

    val viewerName = state.audience.name ?: stringResource(R.string.live_them)
    val opened = state.openedAtMillis
    val viewerDetail = if (opened == null) stringResource(R.string.live_viewer_not_opened) else stringResource(R.string.live_viewer_opened, formats.clock(opened))
    val viewerSpoken = if (opened == null) stringResource(R.string.live_viewer_not_opened_spoken) else viewerDetail
    val viewerStatus = stringResource(if (opened == null) R.string.live_status_waiting else R.string.live_status_watching)
    val note = state.audience.inSentence?.let { stringResource(R.string.live_share_back_note_named, it) } ?: stringResource(R.string.live_share_back_note)

    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(TmlRadius.Md)).background(c.surfaceRaised)) {
        PersonRow(
            person = Person.Sharer(state.look),
            name = you,
            detail = youDetail,
            status = youStatus,
            statusTone = if (quiet) StatusTone.Neutral else StatusTone.Sharer,
            stale = quiet,
            spokenDescription = "$you, $youStatus, $youSpokenDetail",
        )
        PersonRowDivider()
        PersonRow(
            person = Person.Viewer(state.audience.initial),
            name = viewerName,
            detail = viewerDetail,
            status = viewerStatus,
            stale = opened == null,
            spokenDescription = "$viewerName, $viewerStatus, $viewerSpoken",
        )
        Box(Modifier.fillMaxWidth().height(LayoutDefaults.Hairline).background(c.separator))
        Text(
            text = note,
            style = TmlTheme.type.footnote,
            color = c.inkSecondary,
            modifier = Modifier.padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = TmlSpacing.Space2, bottom = TmlSpacing.Space3),
        )
    }
}

/** Location detail mid-session: the control shows the coming choice and says when it takes effect. */
@Composable
private fun PrecisionRow(state: LiveUiState, onChange: (Precision) -> Unit) {
    val c = TmlTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space2)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space4)) {
            Row(
                Modifier.clearAndSetSemantics { },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
            ) {
                Icon(
                    painterResource(R.drawable.ic_my_location),
                    contentDescription = null,
                    tint = c.inkSecondary,
                    modifier = Modifier.size(iconSizeFor(20.dp, AppType.section)),
                )
                Text(stringResource(R.string.live_location), style = AppType.section, color = c.inkSecondary)
            }
            PrecisionControl(state.precisionShown, onChange, Modifier.weight(1f))
        }
        if (state.precisionPending) {
            Row(
                Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    painterResource(R.drawable.ic_schedule),
                    contentDescription = null,
                    tint = c.inkSecondary,
                    modifier = Modifier.padding(top = 1.dp).size(iconSizeFor(16.dp, AppType.note)),
                )
                Text(
                    stringResource(if (state.precisionShown == Precision.APPROXIMATE) R.string.live_next_approximate else R.string.live_next_precise),
                    style = AppType.note,
                    color = c.inkSecondary,
                )
            }
        }
    }
}

/** Stop sharing your location? Cancel first; Stop in flare text (prototype › alert 'stop'). */
@Composable
private fun StopDialog(state: LiveUiState, actions: LiveActions) {
    val c = TmlTheme.colors
    val name = state.audience.inSentence
    val body = when {
        state.openedAtMillis == null -> stringResource(R.string.stop_body_unseen)
        name != null -> stringResource(R.string.stop_body_seen_named, name)
        else -> stringResource(R.string.stop_body_seen)
    }
    AlertDialog(
        onDismissRequest = actions.onStopCancelled,
        title = { Text(stringResource(R.string.stop_title)) },
        text = { Text(body) },
        confirmButton = {
            TmlButton(text = stringResource(R.string.stop_confirm), onClick = actions.onStopConfirmed, variant = ButtonVariant.PlainDanger)
        },
        dismissButton = {
            TmlButton(text = stringResource(R.string.stop_cancel), onClick = actions.onStopCancelled, variant = ButtonVariant.Plain)
        },
        containerColor = c.surface,
        titleContentColor = c.ink,
        textContentColor = c.inkSecondary,
    )
}

/** The sheet never covers more than this share of the screen; past it, its content scrolls. */
private const val SHEET_MAX_FRACTION = 0.72f
private val BarAvatar: Dp = 36.dp
private val BarTitle
    @Composable get() = AppType.cardRow
private val BarSub
    @Composable get() = AppType.note
private val LimitStyle
    @Composable get() = AppType.supporting.copy(fontWeight = FontWeight.W500, fontSize = 14.sp)
