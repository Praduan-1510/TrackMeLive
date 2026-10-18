package live.trackme.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.LocalTime
import live.trackme.app.BuildConfig
import live.trackme.app.Names
import live.trackme.app.R
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlTheme

// ---------- Home ----------

/**
 * Home before any call (prototype › viewHome): greeting, the "Not on a call" card and the mascot card.
 * Share live location arrives with the sharing flow in a later sprint; until then nothing here pretends
 * to be tappable.
 */
@Composable
fun HomeScreen(name: String? = null) {
    val c = TmlTheme.colors
    val greeting = remember {
        val h = LocalTime.now().hour
        when {
            h < 12 -> R.string.home_morning
            h < 18 -> R.string.home_afternoon
            else -> R.string.home_evening
        }
    }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
    ) {
        Text(
            text = stringResource(greeting),
            style = AppType.body,
            color = c.inkSecondary,
            modifier = Modifier.padding(top = 28.dp),
        )
        Text(
            text = if (name != null && Names.isValid(name)) stringResource(R.string.home_hi_name, name.trim()) else stringResource(R.string.home_hi),
            style = AppType.headlineBig,
            color = c.ink,
            modifier = Modifier.padding(top = 2.dp).semantics { heading() },
        )

        // Not on a call
        Column(
            Modifier
                .padding(top = 16.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(TmlAndroidRadius.Card))
                .background(c.surface)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(painterResource(R.drawable.ic_call), contentDescription = null, tint = c.inkSecondary, modifier = Modifier.size(20.dp))
                Text(stringResource(R.string.home_not_on_call), style = AppType.cardRow, color = c.inkSecondary)
            }
            Text(stringResource(R.string.home_not_on_call_body), style = AppType.card, color = c.inkSecondary)
        }

        // Your mascot
        Row(
            Modifier
                .padding(top = 16.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(TmlAndroidRadius.Card))
                .background(c.surface)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            MascotOnHalo(modifier = Modifier.size(112.dp), halo = 100.dp, mascot = 104.dp)
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.mascot_fox), style = AppType.title, color = c.ink)
                Text(
                    stringResource(R.string.home_marker),
                    style = AppType.supporting,
                    color = c.inkSecondary,
                    modifier = Modifier.padding(top = 2.dp, bottom = 10.dp),
                )
                StatusPill(stringResource(R.string.status_not_sharing))
            }
        }
    }
}

// ---------- Mascot ----------

/** The person's mascot. The picker (twelve characters, colors, accessories) comes in a later sprint. */
@Composable
fun MascotScreen() {
    val c = TmlTheme.colors
    Column(Modifier.fillMaxSize()) {
        TopLevelTitle(stringResource(R.string.nav_mascot))
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            MascotOnHalo(modifier = Modifier.fillMaxWidth().height(208.dp), halo = 184.dp, mascot = 176.dp, bob = true)
            Text(stringResource(R.string.mascot_fox), style = AppType.title, color = c.ink, modifier = Modifier.padding(top = 8.dp))
            Text(stringResource(R.string.mascot_set_classics), style = AppType.supporting, color = c.inkSecondary)
            Text(
                stringResource(R.string.mascot_body),
                style = AppType.body,
                color = c.inkSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 16.dp, bottom = 24.dp),
            )
        }
    }
}

// ---------- Settings ----------

enum class ThemeMode(val label: Int) {
    System(R.string.settings_theme_system),
    Light(R.string.settings_theme_light),
    Dark(R.string.settings_theme_dark),
}

/** Settings (prototype › viewSettings), starting with Appearance: follow the system, or pick a theme. */
@Composable
fun SettingsScreen(themeMode: ThemeMode, onThemeMode: (ThemeMode) -> Unit) {
    val c = TmlTheme.colors
    Column(Modifier.fillMaxSize()) {
        TopLevelTitle(stringResource(R.string.nav_settings))
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            SectionHeader(stringResource(R.string.settings_appearance), first = true)
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(TmlAndroidRadius.ListOuter))
                    .background(c.surface)
                    .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 16.dp),
            ) {
                ThemeChoice(themeMode, onThemeMode)
            }

            SectionHeader(stringResource(R.string.settings_about))
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .clip(RoundedCornerShape(TmlAndroidRadius.ListOuter))
                    .background(c.surface)
                    .padding(start = 16.dp, end = 20.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.settings_version), style = AppType.listItem, color = c.ink, modifier = Modifier.weight(1f))
                Text(BuildConfig.VERSION_NAME, style = AppType.listItem, color = c.inkSecondary)
            }
            Text(
                stringResource(R.string.settings_fonts),
                style = AppType.supporting,
                color = c.inkSecondary,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 24.dp),
            )
        }
    }
}

/**
 * System / Light / Dark as Material 3 segmented buttons. When the labels no longer fit side by side
 * (large text), the segments stack into one column instead of cutting a label short, like the
 * prototype's `.a-seg` container query (18em for three segments).
 */
@Composable
private fun ThemeChoice(themeMode: ThemeMode, onThemeMode: (ThemeMode) -> Unit) {
    val c = TmlTheme.colors
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        // 18em of the 14sp label. Scale 14sp first: Android 14+ scales large sp values non-linearly.
        val stackBelow = with(LocalDensity.current) { 14.sp.toDp() } * 18
        if (maxWidth >= stackBelow) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                ThemeMode.entries.forEachIndexed { i, mode ->
                    SegmentedButton(
                        selected = mode == themeMode,
                        onClick = { onThemeMode(mode) },
                        shape = SegmentedButtonDefaults.itemShape(index = i, count = ThemeMode.entries.size),
                        colors = SegmentedButtonDefaults.colors(
                            activeContainerColor = c.ink.copy(alpha = 0.10f),
                            activeContentColor = c.ink,
                            activeBorderColor = c.inkTertiary,
                            inactiveContainerColor = Color.Transparent,
                            inactiveContentColor = c.ink,
                            inactiveBorderColor = c.inkTertiary,
                        ),
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) {
                        Text(stringResource(mode.label), style = AppType.button)
                    }
                }
            }
        } else {
            val outer = RoundedCornerShape(20.dp)
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(outer)
                    .border(1.dp, c.inkTertiary, outer)
                    .selectableGroup(),
            ) {
                ThemeMode.entries.forEachIndexed { i, mode ->
                    val selected = mode == themeMode
                    if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(c.inkTertiary))
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .background(if (selected) c.ink.copy(alpha = 0.10f) else Color.Transparent)
                            .selectable(selected = selected, role = Role.RadioButton, onClick = { onThemeMode(mode) })
                            .padding(horizontal = 16.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                    ) {
                        if (selected) {
                            Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = c.ink, modifier = Modifier.size(18.dp))
                        }
                        Text(stringResource(mode.label), style = AppType.button, color = c.ink)
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String, first: Boolean = false) {
    Text(
        text = text,
        style = AppType.section,
        color = TmlTheme.colors.inkSecondary,
        modifier = Modifier
            .padding(start = 16.dp, end = 16.dp, top = if (first) 8.dp else 24.dp, bottom = 8.dp)
            .semantics { heading() },
    )
}
