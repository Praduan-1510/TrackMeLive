package live.trackme.app.ui.permission

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.ButtonVariant
import live.trackme.app.ui.components.PrimaryButton
import live.trackme.app.ui.components.TmlButton
import live.trackme.app.ui.components.iconSizeFor
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Sizes from the prototype's `.ask-art` and `.a-explain`. */
object ExplainerDefaults {
    /** The lamplight halo behind the icon disc. */
    val Halo: Dp = 104.dp

    /** The lamplight disc. */
    val Disc: Dp = 66.dp

    /** The icon on the disc. */
    val Icon: Dp = 30.dp
}

/**
 * Our own explainer before a system prompt (prototype › explainer, Android): a modal bottom sheet with
 * the icon in a lamplight disc, a title, one paragraph, the main action and Not now. Swiping it away or
 * tapping outside counts as Not now. Each action closes the sheet first, then reports.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExplainerSheet(
    @DrawableRes icon: Int,
    title: String,
    body: String,
    confirm: String,
    dismiss: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = TmlTheme.colors
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    fun close(then: () -> Unit) {
        scope.launch { sheetState.hide() }.invokeOnCompletion { then() }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = c.surface) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = TmlSpacing.Space6, end = TmlSpacing.Space6, bottom = TmlSpacing.Space6),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
        ) {
            Box(
                Modifier.padding(top = TmlSpacing.Space1).size(ExplainerDefaults.Halo).clip(CircleShape).background(c.lamplightHalo),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(ExplainerDefaults.Disc).clip(CircleShape).background(c.lamplight), contentAlignment = Alignment.Center) {
                    Icon(
                        painterResource(icon),
                        contentDescription = null,
                        tint = c.onLamplight,
                        modifier = Modifier.size(iconSizeFor(ExplainerDefaults.Icon, AppType.body)),
                    )
                }
            }
            Text(
                text = title,
                style = AppType.sheetTitle,
                color = c.ink,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Text(text = body, style = AppType.body, color = c.inkSecondary, textAlign = TextAlign.Center)
            PrimaryButton(text = confirm, onClick = { close(onConfirm) }, modifier = Modifier.padding(top = TmlSpacing.Space2))
            TmlButton(
                text = dismiss,
                onClick = { close(onDismiss) },
                variant = ButtonVariant.Plain,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            )
        }
    }
}

/**
 * A Material 3 dialog with an icon, a centered title and body, and two text actions: [dismiss] first,
 * then [confirm] (prototype › dialog with an icon, e.g. "Location is off for Track Me Live").
 */
@Composable
fun IconDialog(
    @DrawableRes icon: Int,
    title: String,
    body: String,
    confirm: String,
    dismiss: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = TmlTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(painterResource(icon), contentDescription = null) },
        title = { Text(title, textAlign = TextAlign.Center) },
        text = { Text(body, textAlign = TextAlign.Center) },
        confirmButton = { TmlButton(text = confirm, onClick = onConfirm, variant = ButtonVariant.Plain) },
        dismissButton = { TmlButton(text = dismiss, onClick = onDismiss, variant = ButtonVariant.Plain) },
        containerColor = c.surface,
        iconContentColor = c.inkSecondary,
        titleContentColor = c.ink,
        textContentColor = c.inkSecondary,
    )
}
