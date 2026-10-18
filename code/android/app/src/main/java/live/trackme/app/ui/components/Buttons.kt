package live.trackme.app.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.toRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlColors
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/**
 * The button families on Android (design-system README › Android › Actions, components/Button).
 */
enum class ButtonVariant {
    /** `lamplight` fill, `on-lamplight` label: the screen's one main action. */
    Filled,

    /** `surface-raised` fill, `ink` label: secondary actions. */
    Tonal,

    /** No fill, `ink` label: Not now, Cancel. Never crossing blue in the app. */
    Plain,

    /** `flare-wash` fill, `flare-text` label: Stop sharing. Only for stopping and deleting. */
    Danger,

    /** No fill, `flare-text` label: the confirm button of a destructive dialog. */
    PlainDanger,
}

/** Sizes from the prototype's `.a-btn` (prototype/css/android.css). */
object TmlButtonDefaults {
    /** Height of a regular button (`.a-btn`); the touch target is still 48dp. */
    val Height: Dp = 40.dp

    /** Height of the screen's one main action (`.a-btn.lg`). */
    val LargeHeight: Dp = 56.dp

    /** Leading icon of a regular button. */
    val IconSize: Dp = 20.dp

    /** Leading icon of a large button. */
    val LargeIconSize: Dp = 22.dp

    /** Stroke of the progress ring shown while the action runs. */
    val ProgressStroke: Dp = 2.dp

    /** Corners while pressed; round at rest. */
    val PressedCorner: Dp = TmlAndroidRadius.Pressed

    /** Disabled buttons fade to this alpha, as in the prototype (`.a-btn:disabled`). */
    const val DisabledAlpha = 0.38f
}

/**
 * One button in our tokens. Round at rest; while pressed the corners morph to 10dp. Labels are
 * sentence case, start with a verb and wrap instead of truncating. While [loading], the button shows
 * a progress ring in place of its icon and ignores taps, keeping its colors so it doesn't look broken.
 */
@Composable
fun TmlButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Filled,
    large: Boolean = false,
    @DrawableRes icon: Int? = null,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val (container, content) = variant.colors(TmlTheme.colors)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val reduceMotion = rememberReduceMotion()
    val morph by animateFloatAsState(
        targetValue = if (pressed) 1f else 0f,
        animationSpec = emphasizedSpec(MotionDurations.Long, reduceMotion),
        label = "buttonCorner",
    )
    val fade = if (loading) 1f else TmlButtonDefaults.DisabledAlpha
    val plain = variant == ButtonVariant.Plain || variant == ButtonVariant.PlainDanger
    val horizontal = if (plain) TmlSpacing.Space3 else TmlSpacing.Space6
    val vertical = if (large) TmlSpacing.Space4 else TmlSpacing.Space2
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = if (large) TmlButtonDefaults.LargeHeight else TmlButtonDefaults.Height),
        enabled = enabled && !loading,
        shape = PressMorphShape(morph, TmlButtonDefaults.PressedCorner),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            disabledContainerColor = container.copy(alpha = container.alpha * fade),
            disabledContentColor = content.copy(alpha = fade),
        ),
        contentPadding = PaddingValues(horizontal = horizontal, vertical = vertical),
        interactionSource = interaction,
    ) {
        val label = if (large) AppType.buttonLarge else AppType.button
        val iconSize = iconSizeFor(if (large) TmlButtonDefaults.LargeIconSize else TmlButtonDefaults.IconSize, label)
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(iconSize),
                color = content,
                strokeWidth = TmlButtonDefaults.ProgressStroke,
            )
            Spacer(Modifier.width(TmlSpacing.Space2))
        } else if (icon != null) {
            Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(iconSize))
            Spacer(Modifier.width(TmlSpacing.Space2))
        }
        Text(text = text, style = label, textAlign = TextAlign.Center)
    }
}

/**
 * The screen's one main action: a filled lamplight button, 56dp tall and full width, with
 * on-lamplight text (design-system README › Android › Actions).
 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    TmlButton(
        text = text,
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        variant = ButtonVariant.Filled,
        large = true,
        icon = icon,
        enabled = enabled,
        loading = loading,
    )
}

private fun ButtonVariant.colors(c: TmlColors): Pair<Color, Color> = when (this) {
    ButtonVariant.Filled -> c.lamplight to c.onLamplight
    ButtonVariant.Tonal -> c.surfaceRaised to c.ink
    ButtonVariant.Plain -> Color.Transparent to c.ink
    ButtonVariant.Danger -> c.flareWash to c.flareText
    ButtonVariant.PlainDanger -> Color.Transparent to c.flareText
}

/**
 * Fully round at rest ([fraction] 0) and [pressedRadius] while pressed ([fraction] 1). Round means
 * half the shorter side, so a button that grew taller for wrapped text stays a capsule.
 */
@Immutable
private data class PressMorphShape(val fraction: Float, val pressedRadius: Dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val round = size.minDimension / 2f
        val pressed = with(density) { pressedRadius.toPx() }.coerceAtMost(round)
        val radius = round + (pressed - round) * fraction
        return Outline.Rounded(RoundRect(size.toRect(), CornerRadius(radius)))
    }
}

@ComponentPreviews
@Composable
private fun ButtonsPreview() {
    PreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space2)) {
            PrimaryButton(text = stringResource(R.string.preview_button_share), onClick = {}, icon = R.drawable.ic_call)
            PrimaryButton(text = stringResource(R.string.picker_save), onClick = {}, loading = true)
            TmlButton(text = stringResource(R.string.preview_button_change_timer), onClick = {}, variant = ButtonVariant.Tonal)
            TmlButton(
                text = stringResource(R.string.preview_button_stop),
                onClick = {},
                variant = ButtonVariant.Danger,
                modifier = Modifier.fillMaxWidth(),
            )
            TmlButton(text = stringResource(R.string.preview_button_not_now), onClick = {}, variant = ButtonVariant.Plain)
            TmlButton(text = stringResource(R.string.settings_delete_confirm), onClick = {}, variant = ButtonVariant.PlainDanger)
            TmlButton(text = stringResource(R.string.picker_continue), onClick = {}, enabled = false)
        }
    }
}
