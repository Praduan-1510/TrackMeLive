package live.trackme.app.ui.navigation

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.Emphasized
import live.trackme.app.ui.home.HomeRoute
import live.trackme.app.ui.routes.MascotTabRoute
import live.trackme.app.ui.routes.SettingsRoute
import live.trackme.design.TmlTheme

/** The three top-level destinations, in the prototype's order. */
enum class Tab(@StringRes val label: Int, @DrawableRes val outlined: Int, @DrawableRes val filled: Int) {
    Home(R.string.nav_home, R.drawable.ic_home, R.drawable.ic_home_filled),
    Mascot(R.string.nav_mascot, R.drawable.ic_face, R.drawable.ic_face_filled),
    Settings(R.string.nav_settings, R.drawable.ic_settings, R.drawable.ic_settings_filled),
}

/**
 * Home, Mascot and Settings behind the navigation bar. The selected tab survives rotation and process
 * death. Back from Mascot or Settings returns to Home, the start destination; back from Home leaves
 * the app. Save confirmations and errors show in the snackbar, above the navigation bar.
 */
@Composable
fun MainShell(onShare: () -> Unit = {}, onOpenLive: () -> Unit = {}) {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    val snackbar = remember { SnackbarHostState() }
    BackHandler(enabled = tab != Tab.Home) { tab = Tab.Home }

    Scaffold(
        containerColor = TmlTheme.colors.ground,
        contentWindowInsets = WindowInsets(0),
        snackbarHost = { TmlSnackbarHost(snackbar) },
        bottomBar = { TmlNavigationBar(current = tab, onSelect = { tab = it }) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
            Crossfade(targetState = tab, animationSpec = tween(200), label = "tab") { t ->
                when (t) {
                    Tab.Home -> HomeRoute(onShare = onShare, onOpenLive = onOpenLive)
                    Tab.Mascot -> MascotTabRoute()
                    Tab.Settings -> SettingsRoute(snackbar)
                }
            }
        }
    }
}

/** Snackbars in our tokens: ink on ground (design-system README › Android › Surfaces). */
@Composable
fun TmlSnackbarHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(state, modifier) { data ->
        Snackbar(
            snackbarData = data,
            containerColor = TmlTheme.colors.ink,
            contentColor = TmlTheme.colors.ground,
            actionColor = TmlTheme.colors.ground,
        )
    }
}

/**
 * Material 3 navigation bar in our tokens (design-system README › Android › Navigation): a 56 by 32dp
 * lamplight-wash pill behind the selected icon, filled icon when selected and outlined otherwise, and
 * a label on every item. Built from a Row so the indicator matches the spec's 56dp width exactly.
 */
@Composable
fun TmlNavigationBar(current: Tab, onSelect: (Tab) -> Unit, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .background(c.surface)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(horizontal = 12.dp)
            .selectableGroup(),
    ) {
        Tab.entries.forEach { tab ->
            val selected = tab == current
            val interaction = remember { MutableInteractionSource() }
            val indicator by animateColorAsState(
                targetValue = if (selected) c.lamplightWash else Color.Transparent,
                animationSpec = tween(250, easing = Emphasized),
                label = "navIndicator",
            )
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = 80.dp)
                    .selectable(
                        selected = selected,
                        onClick = { onSelect(tab) },
                        role = Role.Tab,
                        interactionSource = interaction,
                        indication = null,
                    )
                    .padding(top = 12.dp, bottom = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .size(width = 56.dp, height = 32.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(indicator)
                        .indication(interaction, ripple()),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painter = painterResource(if (selected) tab.filled else tab.outlined),
                        contentDescription = null,
                        tint = if (selected) c.lamplightText else c.inkSecondary,
                        modifier = Modifier.size(24.dp),
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = stringResource(tab.label),
                    style = AppType.navLabel,
                    color = if (selected) c.ink else c.inkSecondary,
                )
            }
        }
    }
}
