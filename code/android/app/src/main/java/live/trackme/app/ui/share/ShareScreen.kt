package live.trackme.app.ui.share

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import live.trackme.app.R
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.di.appContainer
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.BackBar
import live.trackme.app.ui.components.BadgeKind
import live.trackme.app.ui.components.LayoutDefaults
import live.trackme.app.ui.components.ListGroup
import live.trackme.app.ui.components.ListRow
import live.trackme.app.ui.components.ListRowSurface
import live.trackme.app.ui.components.MarkerState
import live.trackme.app.ui.components.Person
import live.trackme.app.ui.components.PersonMarker
import live.trackme.app.ui.components.PrimaryButton
import live.trackme.app.ui.components.SegmentedControl
import live.trackme.app.ui.components.StatusBadge
import live.trackme.app.ui.components.iconSizeFor
import live.trackme.app.ui.components.topHairline
import live.trackme.app.ui.map.CityMap
import live.trackme.app.ui.map.CityMapGeometry
import live.trackme.app.ui.signup.FieldMessage
import live.trackme.app.ui.signup.TmlTextField
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.Precision

/**
 * The share screen's route: the view model, the share sheet, the precise-location request, and on to
 * the live screen once the link went out. With [autoShare] (Share again at the 1-hour limit) it shares
 * at once with the usual choices, as the prototype does.
 */
@Composable
fun ShareRoute(autoShare: Boolean, onBack: () -> Unit, onShared: () -> Unit) {
    val container = LocalContext.current.appContainer
    val vm: ShareViewModel = viewModel(factory = ShareViewModel.factory(container, autoShare))
    val state by vm.state.collectAsStateWithLifecycle()
    val sheet = rememberShareSheet(vm::onSheetClosed)
    val precise = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions(), vm::onPreciseResult)
    LaunchedEffect(vm) {
        vm.events.collect { event ->
            when (event) {
                ShareEvent.Shared -> onShared()
                ShareEvent.RequestPrecise -> precise.launch(container.locationPermissions.locationPermissionsToRequest)
            }
        }
    }
    LaunchedEffect(state.sheet) {
        state.sheet?.let {
            sheet.open(it)
            vm.onSheetOpened()
        }
    }
    // The person may have changed location access in Settings meanwhile.
    LifecycleResumeEffect(container) {
        container.locationPermissions.refresh()
        onPauseOrDispose { }
    }
    ShareScreen(
        state = state,
        viewerName = vm.viewerName,
        actions = ShareActions(
            onBack = onBack,
            onViewerNameChange = vm::onViewerNameChange,
            onClearViewerName = vm::clearViewerName,
            onStopChange = vm::onStopChange,
            onPrecisionChange = vm::onPrecisionChange,
            onShare = vm::share,
        ),
    )
}

/** Everything the share screen can report. */
data class ShareActions(
    val onBack: () -> Unit = {},
    val onViewerNameChange: (String) -> Unit = {},
    val onClearViewerName: () -> Unit = {},
    val onStopChange: (StopChoice) -> Unit = {},
    val onPrecisionChange: (Precision) -> Unit = {},
    val onShare: () -> Unit = {},
)

/**
 * Share where you are (prototype › viewShare, Android, without a call): the preview of what they'll
 * see, who it's for, when it stops and how precise, and Share live location pinned at the bottom with
 * "Next, choose who gets the link." Stateless: it draws [state] and reports through [actions]; the
 * timer sheet is its own UI state.
 */
@Composable
fun ShareScreen(state: ShareUiState, viewerName: String, actions: ShareActions, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val formats = rememberShareFormats()
    var showStops by rememberSaveable { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    // While the session is being made or its share sheet is up, Back waits: leaving now would strand a
    // link nobody got. The sheet's own Back closes it, and an unsent link is taken back.
    BackHandler(enabled = state.busy) { }
    Column(modifier.fillMaxSize().background(c.ground).imePadding()) {
        BackBar(backLabel = stringResource(R.string.share_back), onBack = { if (!state.busy) actions.onBack() })
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, bottom = TmlSpacing.Space5),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = LayoutDefaults.ContentMaxWidth)) {
                Text(
                    text = stringResource(R.string.share_title),
                    style = AppType.appBar,
                    color = c.ink,
                    modifier = Modifier.padding(top = TmlSpacing.Space1).semantics { heading() },
                )
                Text(
                    text = stringResource(R.string.share_lede),
                    style = AppType.body,
                    color = c.inkSecondary,
                    modifier = Modifier.padding(top = TmlSpacing.Space2),
                )
                SharePreview(state, Modifier.padding(top = TmlSpacing.Space5))
                TmlTextField(
                    value = viewerName,
                    onValueChange = actions.onViewerNameChange,
                    label = stringResource(R.string.share_viewer_label),
                    placeholder = stringResource(R.string.share_viewer_placeholder),
                    helper = stringResource(R.string.share_viewer_help),
                    error = if (state.nameError) stringResource(R.string.share_viewer_error) else null,
                    trailing = if (viewerName.isNotBlank()) {
                        {
                            IconButton(onClick = actions.onClearViewerName, modifier = Modifier.size(48.dp)) {
                                Icon(painterResource(R.drawable.ic_cancel_filled), contentDescription = stringResource(R.string.share_viewer_clear))
                            }
                        }
                    } else {
                        null
                    },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, autoCorrectEnabled = false, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
                    modifier = Modifier.padding(top = TmlSpacing.Space6),
                )
                ListGroup(Modifier.padding(top = TmlSpacing.Space4)) {
                    ListRow(
                        headline = stringResource(R.string.share_stops),
                        supporting = stopLabel(state.stop, expiresAtMillis = null, formats = formats),
                        leadingIcon = R.drawable.ic_timer,
                        onClick = { showStops = true },
                    )
                    LocationRow(state.precision, actions.onPrecisionChange)
                }
            }
        }
        ShareBottom(state, actions.onShare)
    }
    if (showStops) {
        StopTimeSheet(
            options = state.stopOptions,
            selected = state.stop,
            expiresAtMillis = null,
            onPick = actions.onStopChange,
            onDismiss = { showStops = false },
        )
    }
}

/**
 * What they'll see (prototype `.share-preview`): the sharer's mascot on the map, with "LIVE · They see
 * you move as you go" over it. The picture is decorative; the caption is read.
 */
@Composable
private fun SharePreview(state: ShareUiState, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val shape = RoundedCornerShape(TmlAndroidRadius.Dialog)
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(PreviewHeight)
            .clip(shape)
            .border(LayoutDefaults.Hairline, c.separator, shape),
    ) {
        // The marker sits where the prototype puts it: 150 by 88 in a 358 by 210 preview.
        val x = maxWidth * (MarkerX / PreviewWidth)
        Box(Modifier.fillMaxSize().clearAndSetSemantics { }) {
            CityMap(Modifier.fillMaxSize(), focus = CityMapGeometry.Start, focusAt = Offset(MarkerX / PreviewWidth, MarkerY / PreviewHeightDp))
            val you = stringResource(R.string.share_preview_you)
            PersonMarker(
                person = Person.Sharer(state.look),
                label = you,
                contentDescription = you,
                state = if (state.precision == Precision.APPROXIMATE) MarkerState.Approximate else MarkerState.Live,
                modifier = Modifier.offset(x - HaloHalf, MarkerY.dp - HaloHalf),
            )
        }
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(TmlSpacing.Space3)
                .clip(RoundedCornerShape(16.dp))
                .background(c.surface)
                .semantics(mergeDescendants = true) { }
                .padding(horizontal = TmlSpacing.Space3, vertical = TmlSpacing.Space2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
        ) {
            StatusBadge(stringResource(R.string.badge_live), kind = BadgeKind.Live, spoken = stringResource(R.string.badge_live_spoken))
            Text(stringResource(R.string.share_preview_caption), style = TmlTheme.type.footnote, color = c.inkSecondary)
        }
    }
}

/** Location: Precise or Approximate, as segmented buttons under the row's headline (prototype `.a-li.stack.lead-row`). */
@Composable
private fun LocationRow(precision: Precision, onChange: (Precision) -> Unit) {
    val c = TmlTheme.colors
    ListRowSurface {
        Row(
            Modifier.padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = 14.dp, bottom = TmlSpacing.Space4),
            horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space4),
        ) {
            Icon(
                painterResource(R.drawable.ic_my_location),
                contentDescription = null,
                tint = c.inkSecondary,
                modifier = Modifier.padding(top = 2.dp).size(iconSizeFor(24.dp, AppType.listItem)),
            )
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.share_location), style = AppType.listItem, color = c.ink)
                PrecisionControl(precision, onChange)
            }
        }
    }
}

/** Precise or Approximate, the same control on the share screen and the live screen. */
@Composable
fun PrecisionControl(precision: Precision, onChange: (Precision) -> Unit, modifier: Modifier = Modifier) {
    val labels = listOf(stringResource(R.string.live_precise), stringResource(R.string.live_approximate))
    SegmentedControl(
        labels = labels,
        selectedIndex = if (precision == Precision.PRECISE) 0 else 1,
        onSelect = { onChange(if (it == 0) Precision.PRECISE else Precision.APPROXIMATE) },
        modifier = modifier,
    )
}

/** Share live location, pinned at the bottom (prototype `.a-bottom`), with why it didn't start above it. */
@Composable
private fun ShareBottom(state: ShareUiState, onShare: () -> Unit) {
    val c = TmlTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.ground)
            .topHairline(c.separator)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = TmlSpacing.Space3, bottom = TmlSpacing.Space5),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = LayoutDefaults.ContentMaxWidth)) {
            state.error?.let { error ->
                FieldMessage(stringResource(error.message), isError = true, modifier = Modifier.padding(bottom = TmlSpacing.Space3))
            }
            PrimaryButton(
                text = stringResource(R.string.share_button),
                onClick = onShare,
                icon = R.drawable.ic_near_me_filled,
                loading = state.busy,
            )
            Text(
                text = stringResource(R.string.share_fine),
                style = AppType.fine,
                color = c.inkSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = TmlSpacing.Space2),
            )
        }
    }
}

private val ShareError.message: Int
    get() = when (this) {
        ShareError.Network -> R.string.share_error_network
        ShareError.AlreadySharing -> R.string.share_error_already
        ShareError.Location -> R.string.share_error_location
        ShareError.Other -> R.string.share_error_other
    }

private const val PreviewWidth = 358f
private const val PreviewHeightDp = 210f
private const val MarkerX = 150f
private const val MarkerY = 88f
private val PreviewHeight = PreviewHeightDp.dp
private val HaloHalf = 40.dp
