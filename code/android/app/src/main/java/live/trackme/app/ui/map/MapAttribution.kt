package live.trackme.app.ui.map

import android.content.ActivityNotFoundException
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.ButtonVariant
import live.trackme.app.ui.components.LayoutDefaults
import live.trackme.app.ui.components.TmlButton
import live.trackme.app.ui.components.iconSizeFor
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Where each credit links (the licenses ask for the copyright page). */
object MapCredits {
    const val OPENFREEMAP_URL = "https://openfreemap.org"
    const val OPENMAPTILES_URL = "https://www.openmaptiles.org/"
    const val OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
}

/**
 * The tile map's credits, always on the map while it shows (OpenFreeMap's tiles and OpenStreetMap's
 * ODbL ask for them): "OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors" on a `surface`
 * capsule, in caption type that wraps rather than cuts at large text sizes. It's one button for
 * TalkBack ("Map data: …, double-tap to show the map's sources") with a 48dp touch target, and opens
 * the three sources with links to them.
 */
@Composable
fun MapAttribution(modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    var open by rememberSaveable { mutableStateOf(false) }
    val spoken = stringResource(R.string.map_attribution_spoken)
    val action = stringResource(R.string.map_attribution_action)
    val shape = RoundedCornerShape(CapsuleRadius)
    Box(
        modifier
            .heightIn(min = MinTouch)
            .clickable(role = Role.Button, onClickLabel = action) { open = true }
            .clearAndSetSemantics {
                contentDescription = spoken
                role = Role.Button
                onClick(label = action) {
                    open = true
                    true
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text = stringResource(R.string.map_attribution),
            style = TmlTheme.type.caption1,
            color = c.inkSecondary,
            modifier = Modifier
                .widthIn(max = MaxWidth)
                .clip(shape)
                .background(c.surface.copy(alpha = CAPSULE_ALPHA))
                .border(LayoutDefaults.Hairline, c.separator, shape)
                .padding(horizontal = 10.dp, vertical = 3.dp),
        )
    }
    if (open) MapCreditsDialog(onDismiss = { open = false })
}

/** The three sources, each a row that opens its page in the browser. */
@Composable
internal fun MapCreditsDialog(onDismiss: () -> Unit) {
    val c = TmlTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.map_credits_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space1)) {
                Text(stringResource(R.string.map_credits_body), style = TmlTheme.type.subheadline, color = c.inkSecondary)
                CreditRow(stringResource(R.string.map_credit_openfreemap), "openfreemap.org", MapCredits.OPENFREEMAP_URL)
                CreditRow(stringResource(R.string.map_credit_openmaptiles), "openmaptiles.org", MapCredits.OPENMAPTILES_URL)
                CreditRow(stringResource(R.string.map_credit_osm), "openstreetmap.org/copyright", MapCredits.OSM_COPYRIGHT_URL)
            }
        },
        confirmButton = {
            TmlButton(text = stringResource(R.string.map_credits_close), onClick = onDismiss, variant = ButtonVariant.Plain)
        },
        containerColor = c.surface,
        titleContentColor = c.ink,
        textContentColor = c.inkSecondary,
    )
}

@Composable
private fun CreditRow(name: String, address: String, url: String) {
    val c = TmlTheme.colors
    val uri = LocalUriHandler.current
    val open = stringResource(R.string.map_credit_open)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = MinTouch)
            .clip(RoundedCornerShape(TmlSpacing.Space2))
            .clickable(role = Role.Button, onClickLabel = open) {
                try {
                    uri.openUri(url)
                } catch (e: ActivityNotFoundException) {
                    // No browser: the address is on screen to type elsewhere.
                    Log.w(TAG, "no app opens $url", e)
                } catch (e: IllegalArgumentException) {
                    Log.w(TAG, "can't open $url", e)
                }
            }
            .padding(vertical = TmlSpacing.Space1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
    ) {
        Column(Modifier.weight(1f)) {
            Text(name, style = AppType.cardRow, color = c.ink)
            Text(address, style = TmlTheme.type.footnote, color = c.inkSecondary)
        }
        Icon(
            painterResource(R.drawable.ic_chevron_right),
            contentDescription = null,
            tint = c.inkSecondary,
            modifier = Modifier.size(iconSizeFor(20.dp, AppType.cardRow)),
        )
    }
}

private val MinTouch = 48.dp
private val CapsuleRadius = 12.dp
private val MaxWidth = 320.dp

/** Nearly solid, so the credits read on any tile; the map's color still shows at the edge. */
private const val CAPSULE_ALPHA = 0.94f
private const val TAG = "TmlMap"
