package live.trackme.app.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Sizes from the prototype's `.a-group` and `.a-li` (prototype/css/android.css). */
object ListDefaults {
    /** The gap between rows of a grouped list, where the ground shows through. */
    val RowGap: Dp = 2.dp

    /** A one-line row. */
    val RowMinHeight: Dp = 56.dp

    /** A row with supporting text. */
    val TwoLineMinHeight: Dp = 72.dp

    /** The leading icon. */
    val IconSize: Dp = 24.dp

    /** The icon on a switch's thumb. */
    val SwitchIconSize: Dp = 16.dp
}

/** How a row reads: plain, or the flare-text row that deletes (Delete account and all data). */
enum class RowTone { Default, Danger }

/**
 * A grouped list: `surface` rows on `ground` with 2dp gaps, 20dp outer corners and 4dp inner ones
 * (design-system README › Android › Corners). Each row clips to the inner corner and the group to the
 * outer one, so the first and last rows get the round corners wherever they are.
 */
@Composable
fun ListGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(TmlAndroidRadius.ListOuter)),
        verticalArrangement = Arrangement.spacedBy(ListDefaults.RowGap),
        content = content,
    )
}

/** The bare row surface: `surface`, inner corners, prototype padding, and room to grow with text. */
@Composable
fun ListRowSurface(
    modifier: Modifier = Modifier,
    twoLine: Boolean = false,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = if (twoLine) ListDefaults.TwoLineMinHeight else ListDefaults.RowMinHeight)
            .clip(RoundedCornerShape(TmlAndroidRadius.ListInner))
            .background(TmlTheme.colors.surface),
        verticalArrangement = Arrangement.Center,
    ) { content() }
}

/**
 * One list item: an optional leading icon, the headline, optional supporting text and an optional
 * trailing control. With [onClick] the whole row is one button; text wraps, never truncates.
 */
@Composable
fun ListRow(
    headline: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    @DrawableRes leadingIcon: Int? = null,
    tone: RowTone = RowTone.Default,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = TmlTheme.colors
    val ink = if (tone == RowTone.Danger) c.flareText else c.ink
    ListRowSurface(
        // A row reads as one element either way: a button, or its headline and supporting text together.
        modifier = modifier.then(
            if (onClick != null) {
                Modifier.clickable(role = Role.Button, onClick = onClick)
            } else {
                Modifier.semantics(mergeDescendants = true) {}
            },
        ),
        twoLine = supporting != null,
    ) {
        RowContent(
            headline = headline,
            supporting = supporting,
            leadingIcon = leadingIcon,
            iconTint = if (tone == RowTone.Danger) c.flareText else c.inkSecondary,
            headlineColor = ink,
            trailing = trailing,
        )
    }
}

@Composable
private fun RowContent(
    headline: String,
    supporting: String?,
    @DrawableRes leadingIcon: Int?,
    iconTint: Color,
    headlineColor: Color,
    trailing: (@Composable () -> Unit)?,
) {
    Row(
        Modifier.padding(start = TmlSpacing.Space4, end = TmlSpacing.Space5, top = TmlSpacing.Space2, bottom = TmlSpacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space4),
    ) {
        if (leadingIcon != null) {
            Icon(
                painter = painterResource(leadingIcon),
                contentDescription = null,
                tint = iconTint,
                modifier = Modifier.size(iconSizeFor(ListDefaults.IconSize, AppType.listItem)),
            )
        }
        Column(Modifier.weight(1f)) {
            Text(headline, style = AppType.listItem, color = headlineColor)
            if (supporting != null) {
                Text(supporting, style = AppType.supporting, color = TmlTheme.colors.inkSecondary)
            }
        }
        trailing?.invoke()
    }
}

/**
 * A row with a switch. The whole row toggles and reads as one switch: "Offer to share when I'm on a
 * call, When Track Me Live is open, switch, on". [viewer] gives the switch crossing blue, for share
 * back where the viewer is the one acting.
 */
@Composable
fun SwitchRow(
    headline: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    viewer: Boolean = false,
    enabled: Boolean = true,
) {
    ListRowSurface(
        modifier = modifier.toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange),
        twoLine = supporting != null,
    ) {
        RowContent(
            headline = headline,
            supporting = supporting,
            leadingIcon = null,
            iconTint = TmlTheme.colors.inkSecondary,
            headlineColor = TmlTheme.colors.ink,
            trailing = { TmlSwitch(checked = checked, onCheckedChange = null, viewer = viewer, enabled = enabled) },
        )
    }
}

/**
 * Material 3 switch in our tokens: a `lamplight` track (`crossing` for share back) with a check or a
 * cross on the thumb, so the state never rests on color alone. Pass a null [onCheckedChange] when
 * the row around it does the toggling.
 */
@Composable
fun TmlSwitch(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    viewer: Boolean = false,
    enabled: Boolean = true,
) {
    val c = TmlTheme.colors
    val track = if (viewer) c.crossing else c.lamplight
    // The thumb is the light surface on the track in light, and the dark on- color in dark (prototype --a-thumb-on).
    val thumbOn = when {
        !c.isDark -> c.surface
        viewer -> c.onCrossing
        else -> c.onLamplight
    }
    val iconOn = if (viewer) c.crossingText else c.lamplightText
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        thumbContent = {
            Icon(
                painter = painterResource(if (checked) R.drawable.ic_check else R.drawable.ic_close),
                contentDescription = null,
                modifier = Modifier.size(ListDefaults.SwitchIconSize),
            )
        },
        colors = SwitchDefaults.colors(
            checkedThumbColor = thumbOn,
            checkedTrackColor = track,
            checkedBorderColor = track,
            checkedIconColor = iconOn,
            uncheckedThumbColor = c.inkTertiary,
            uncheckedTrackColor = c.surfaceRaised,
            uncheckedBorderColor = c.inkTertiary,
            uncheckedIconColor = c.surfaceRaised,
            disabledCheckedThumbColor = thumbOn.copy(alpha = TmlButtonDefaults.DisabledAlpha),
            disabledCheckedTrackColor = track.copy(alpha = TmlButtonDefaults.DisabledAlpha),
            disabledCheckedBorderColor = track.copy(alpha = TmlButtonDefaults.DisabledAlpha),
            disabledCheckedIconColor = iconOn.copy(alpha = TmlButtonDefaults.DisabledAlpha),
            disabledUncheckedThumbColor = c.inkTertiary.copy(alpha = TmlButtonDefaults.DisabledAlpha),
            disabledUncheckedTrackColor = c.surfaceRaised.copy(alpha = TmlButtonDefaults.DisabledAlpha),
            disabledUncheckedBorderColor = c.inkTertiary.copy(alpha = TmlButtonDefaults.DisabledAlpha),
            disabledUncheckedIconColor = c.surfaceRaised.copy(alpha = TmlButtonDefaults.DisabledAlpha),
        ),
    )
}

/**
 * A row that holds a control under its headline, such as Location detail and its segmented buttons
 * (prototype `.a-li.stack`).
 */
@Composable
fun StackedRow(headline: String?, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    ListRowSurface(modifier = modifier) {
        Column(
            Modifier.padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = TmlSpacing.Space3, bottom = TmlSpacing.Space4),
            verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
        ) {
            if (headline != null) Text(headline, style = AppType.listItem, color = TmlTheme.colors.ink)
            content()
        }
    }
}

/** One radio choice in a sheet or a list: the whole row selects, and reads as a radio button. */
@Composable
fun RadioRow(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = ListDefaults.RowMinHeight)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = TmlSpacing.Space4, vertical = TmlSpacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space4),
    ) {
        RadioButton(
            selected = selected,
            onClick = null,
            colors = RadioButtonDefaults.colors(selectedColor = c.lamplightText, unselectedColor = c.inkSecondary),
        )
        Text(text, style = AppType.listItem, color = c.ink, modifier = Modifier.weight(1f))
    }
}

/** The heading over a grouped list, read by TalkBack as a heading. */
@Composable
fun SectionHeader(text: String, modifier: Modifier = Modifier, first: Boolean = false) {
    Text(
        text = text,
        style = AppType.section,
        color = TmlTheme.colors.inkSecondary,
        modifier = modifier
            .padding(
                start = TmlSpacing.Space4,
                end = TmlSpacing.Space4,
                top = if (first) TmlSpacing.Space2 else TmlSpacing.Space6,
                bottom = TmlSpacing.Space2,
            )
            .semantics { heading() },
    )
}

/** Small print under a group (prototype `.a-foot`). */
@Composable
fun ListFootnote(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = TmlTheme.type.footnote,
        color = TmlTheme.colors.inkSecondary,
        modifier = modifier.padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = TmlSpacing.Space2),
    )
}

@ComponentPreviews
@Composable
private fun ListGroupPreview() {
    PreviewSurface {
        Column {
            SectionHeader(stringResource(R.string.settings_section_sharing), first = true)
            ListGroup {
                SwitchRow(
                    headline = stringResource(R.string.settings_offer_on_call),
                    supporting = stringResource(R.string.settings_offer_on_call_detail),
                    checked = true,
                    onCheckedChange = {},
                )
                SwitchRow(headline = stringResource(R.string.settings_alert_expiry), checked = false, onCheckedChange = {})
                ListRow(
                    headline = stringResource(R.string.settings_default_stop),
                    supporting = stringResource(R.string.settings_stop_call),
                    onClick = {},
                )
                ListRow(
                    headline = stringResource(R.string.settings_delete_account),
                    leadingIcon = R.drawable.ic_delete,
                    tone = RowTone.Danger,
                    onClick = {},
                )
            }
            ListFootnote(stringResource(R.string.settings_retention_note))
            ListGroup(Modifier.padding(top = TmlSpacing.Space4)) {
                RadioRow(text = stringResource(R.string.settings_stop_call), selected = true, onClick = {})
                RadioRow(text = stringResource(R.string.settings_stop_15), selected = false, onClick = {})
            }
        }
    }
}
