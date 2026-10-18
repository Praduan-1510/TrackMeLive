package live.trackme.app.ui

import android.provider.Settings
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlTheme

/** Material 3 emphasized easing, used for shape and indicator changes. */
val Emphasized = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** True when the person turned animations off (Settings › Accessibility › Remove animations). */
@Composable
fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) {
        Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}

/**
 * The screen's one main action: a filled lamplight button, 56dp tall, with on-lamplight text.
 * Round at rest; pressing morphs the corners to 10dp (design-system README, Android › Actions).
 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
) {
    val c = TmlTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val corner by animateDpAsState(
        targetValue = if (pressed) TmlAndroidRadius.Pressed else 28.dp,
        animationSpec = tween(durationMillis = 300, easing = Emphasized),
        label = "pressCorner",
    )
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = RoundedCornerShape(corner),
        colors = ButtonDefaults.buttonColors(containerColor = c.lamplight, contentColor = c.onLamplight),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 16.dp),
        interactionSource = interaction,
    ) {
        if (icon != null) {
            Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = AppType.buttonLarge)
    }
}

/**
 * The fox (or later, the person's mascot) on a soft lamplight halo. Decorative: the words beside it
 * say what it is, so TalkBack skips it. With [bob], it rises 3dp and settles over 2.8 s, as in the
 * prototype; Remove animations turns that off.
 */
@Composable
fun MascotOnHalo(
    modifier: Modifier = Modifier,
    halo: Dp,
    mascot: Dp,
    bob: Boolean = false,
    @DrawableRes art: Int = R.drawable.mascot_fox,
) {
    val reduceMotion = rememberReduceMotion()
    val lift = if (bob && !reduceMotion) {
        val t = rememberInfiniteTransition(label = "bob")
        t.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(1400, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "bobLift",
        )
    } else {
        null
    }
    val bobPx = with(LocalDensity.current) { 3.dp.toPx() }
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(Modifier.size(halo).clip(CircleShape).background(TmlTheme.colors.lamplightHalo))
        Image(
            painter = painterResource(art),
            contentDescription = null,
            modifier = Modifier
                .size(mascot)
                .graphicsLayer { translationY = -(lift?.value ?: 0f) * bobPx },
        )
    }
}

/** Top app bar for top-level screens: the title in Gabarito 28/36 on ground, under the status bar. */
@Composable
fun TopLevelTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = AppType.appBar,
        color = TmlTheme.colors.ink,
        modifier = modifier
            .fillMaxWidth()
            .background(TmlTheme.colors.ground)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp)
            .semantics { heading() },
    )
}

/** A neutral status pill with a ring dot: "Not sharing". Every state has a word, never color alone. */
@Composable
fun StatusPill(text: String, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    Row(
        modifier = modifier
            .heightIn(min = 28.dp)
            .clip(RoundedCornerShape(50))
            .background(c.surfaceRaised)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(8.dp).border(2.dp, c.inkSecondary, CircleShape))
        Text(text, style = AppType.pill, color = c.inkSecondary)
    }
}
