package live.trackme.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Sizes from the prototype's `.a-bsheet` and `.a-handle`. */
object MapSheetDefaults {
    /** The decorative handle at the top. */
    val Handle: DpSize = DpSize(32.dp, 4.dp)

    /** The handle is `ink-tertiary` at half strength, as in the prototype. */
    const val HANDLE_ALPHA = 0.5f

    /** Space above the handle. */
    val HandleTop: Dp = 14.dp
}

/**
 * The sheet over the map on Android (prototype `.a-bsheet`): an opaque `surface` sheet with 28dp top
 * corners and a hairline edge, holding the session's title (with an optional badge), one line under
 * it, the content (stat tiles, person rows) and up to two actions. The content scrolls when it
 * outgrows the sheet; the actions stay pinned at its bottom, above the navigation bar, so Stop
 * sharing is always reachable. Callers cap its height (about half the screen at rest).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MapSheet(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    badge: (@Composable () -> Unit)? = null,
    actions: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = TmlTheme.colors
    val shape = RoundedCornerShape(topStart = TmlAndroidRadius.Dialog, topEnd = TmlAndroidRadius.Dialog)
    val scroll = rememberScrollState()
    BoxWithConstraints(modifier.fillMaxWidth()) {
        // With a height to fit in, the content scrolls above the pinned actions; without one (inside a
        // scrolling parent) the sheet simply takes the height of its content.
        val bounded = constraints.hasBoundedHeight
        Column(
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(c.surface)
                .border(LayoutDefaults.Hairline, c.separator, shape),
        ) {
            Column(
                (if (bounded) Modifier.weight(1f, fill = false).verticalScroll(scroll) else Modifier)
                    .padding(horizontal = TmlSpacing.Space4),
                verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space4),
            ) {
                Box(
                    Modifier
                        .padding(top = MapSheetDefaults.HandleTop)
                        .align(Alignment.CenterHorizontally)
                        .size(MapSheetDefaults.Handle)
                        .clip(RoundedCornerShape(percent = 50))
                        .background(c.inkTertiary.copy(alpha = MapSheetDefaults.HANDLE_ALPHA)),
                )
                Column(verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space1)) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
                        verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space1),
                        itemVerticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(title, style = TmlTheme.type.title2, color = c.ink, modifier = Modifier.semantics { heading() })
                        badge?.invoke()
                    }
                    if (subtitle != null) Text(subtitle, style = TmlTheme.type.callout, color = c.inkSecondary)
                }
                content()
                if (actions == null) Box(Modifier.windowInsetsPadding(WindowInsets.navigationBars))
            }
            if (actions != null) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(c.surface)
                        .windowInsetsPadding(WindowInsets.navigationBars)
                        .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = TmlSpacing.Space4, bottom = TmlSpacing.Space4),
                ) { actions() }
            }
        }
    }
}

/** A neutral action and Stop sharing side by side, or stacked when either label would wrap. */
@Composable
fun SheetActions(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    AdaptiveRow(modifier = modifier.fillMaxWidth(), horizontalGap = TmlSpacing.Space2, verticalGap = TmlSpacing.Space2, content = content)
}

@ComponentPreviews
@Composable
private fun MapSheetPreview() {
    PreviewTheme {
        Box(Modifier.background(TmlTheme.colors.mapLand).padding(top = TmlSpacing.Space8)) {
            MapSheet(
                title = stringResource(R.string.preview_sheet_title),
                subtitle = stringResource(R.string.preview_sheet_subtitle),
                badge = { StatusBadge(stringResource(R.string.preview_badge_together), kind = BadgeKind.Together) },
                actions = {
                    SheetActions {
                        TmlButton(stringResource(R.string.preview_button_change_timer), onClick = {}, variant = ButtonVariant.Tonal)
                        TmlButton(stringResource(R.string.preview_button_stop), onClick = {}, variant = ButtonVariant.Danger)
                    }
                },
            ) {
                StatTileRow {
                    StatTile(stringResource(R.string.preview_stat_distance), stringResource(R.string.preview_stat_distance_label))
                    StatTile(stringResource(R.string.preview_stat_call), stringResource(R.string.preview_stat_call_label))
                }
                Column {
                    PersonRow(
                        person = Person.Sharer(MascotLook()),
                        name = stringResource(R.string.preview_name_you),
                        detail = stringResource(R.string.preview_detail_updated),
                        status = stringResource(R.string.preview_status_live),
                        statusTone = StatusTone.Sharer,
                    )
                    PersonRowDivider()
                    PersonRow(
                        person = Person.Viewer(stringResource(R.string.preview_name_mom).take(1)),
                        name = stringResource(R.string.preview_name_mom),
                        detail = stringResource(R.string.preview_detail_sharing_back),
                        status = stringResource(R.string.preview_status_live),
                        statusTone = StatusTone.Viewer,
                    )
                }
            }
        }
    }
}
