package live.trackme.app.ui.home

import android.text.BidiFormatter
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import live.trackme.app.ui.components.BadgeKind
import live.trackme.app.ui.components.PillKind
import live.trackme.app.ui.components.PrimaryButton
import live.trackme.app.ui.components.StatusBadge
import live.trackme.app.ui.permission.rememberLocationGate
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.PreviewParameter
import androidx.compose.ui.tooling.preview.PreviewParameterProvider
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.platform.LocalContext
import live.trackme.app.di.appContainer
import live.trackme.app.R
import live.trackme.app.domain.Greeting
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.PreviewTheme
import live.trackme.app.ui.components.ScreenPreviews
import live.trackme.app.ui.components.StatusPill
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.mascot.MascotOnHalo
import live.trackme.app.ui.mascot.mascotNameRes
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId

/**
 * Home's route. Share live location goes through the location gate (the explainer and the system
 * dialog the first time), then [onShare] opens the share screen.
 */
@Composable
fun HomeRoute(onShare: () -> Unit = {}, onOpenLive: () -> Unit = {}) {
    val vm: HomeViewModel = viewModel(factory = HomeViewModel.factory(LocalContext.current.appContainer))
    val state by vm.state.collectAsStateWithLifecycle()
    val gate = rememberLocationGate(onGranted = onShare)
    HomeScreen(state, onShare = gate::start, onOpenLive = onOpenLive)
}

/**
 * Home, not on a call (prototype › viewHome): the greeting with the person's name, the "Not on a call"
 * card, their mascot, and Share live location with "You'll choose who gets the link." While sharing,
 * the live card ("Sharing with Mom · Tap to open the map.") takes the call card's place, the mascot's
 * pill says Sharing live, and the Share button goes.
 */
@Composable
fun HomeScreen(state: HomeUiState, modifier: Modifier = Modifier, onShare: () -> Unit = {}, onOpenLive: () -> Unit = {}) {
    val c = TmlTheme.colors
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, bottom = TmlSpacing.Space6),
    ) {
        Text(
            text = stringResource(state.greeting.label),
            style = AppType.body,
            color = c.inkSecondary,
            modifier = Modifier.padding(top = 28.dp),
        )
        val hi = when {
            // The name is direction-isolated, so a right-to-left name never reorders the greeting around it.
            state.name != null -> stringResource(R.string.home_hi_name, BidiFormatter.getInstance().unicodeWrap(state.name))
            else -> stringResource(R.string.home_hi)
        }
        Text(
            text = hi,
            style = AppType.headlineBig,
            color = c.ink,
            // Until the profile loads, the line keeps its height (so nothing jumps when the name arrives)
            // but is neither drawn nor read out.
            modifier = Modifier
                .padding(top = 2.dp)
                .then(if (state.loaded) Modifier.semantics { heading() } else Modifier.alpha(0f).clearAndSetSemantics { }),
        )

        if (state.live) {
            LiveCard(state.liveWith, onOpenLive, Modifier.padding(top = TmlSpacing.Space4))
        } else {
            NotOnCallCard(Modifier.padding(top = TmlSpacing.Space4))
        }
        MascotCard(state, Modifier.padding(top = TmlSpacing.Space4))
        if (!state.live) {
            PrimaryButton(
                text = stringResource(R.string.home_share),
                onClick = onShare,
                icon = R.drawable.ic_near_me_filled,
                modifier = Modifier.padding(top = TmlSpacing.Space6),
            )
            Text(
                text = stringResource(R.string.home_share_fine),
                style = AppType.fine,
                color = c.inkSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = TmlSpacing.Space2),
            )
        }
    }
}

/**
 * While sharing (prototype `.a-card.live`): one button on lamplight wash, "LIVE · Sharing with Mom" over
 * "Tap to open the map.", with a chevron. It opens the live map.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LiveCard(with: String?, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val title = if (with != null) {
        stringResource(R.string.home_live_with, BidiFormatter.getInstance().unicodeWrap(with))
    } else {
        stringResource(R.string.home_live)
    }
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TmlAndroidRadius.Card))
            .background(c.lamplightWash)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(TmlSpacing.Space4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space3)) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space1),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                StatusBadge(stringResource(R.string.badge_live), kind = BadgeKind.Live, spoken = stringResource(R.string.badge_live_spoken))
                Text(title, style = AppType.cardRow, color = c.lamplightText)
            }
            Text(stringResource(R.string.home_live_open), style = AppType.card, color = c.ink)
        }
        Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = c.lamplightText, modifier = Modifier.size(24.dp))
    }
}

@Composable
private fun NotOnCallCard(modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TmlAndroidRadius.Card))
            .background(c.surface)
            .padding(TmlSpacing.Space4),
        verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(painterResource(R.drawable.ic_call), contentDescription = null, tint = c.inkSecondary, modifier = Modifier.size(20.dp))
            Text(stringResource(R.string.home_not_on_call), style = AppType.cardRow, color = c.inkSecondary)
        }
        Text(stringResource(R.string.home_not_on_call_body), style = AppType.card, color = c.inkSecondary)
    }
}

@Composable
private fun MascotCard(state: HomeUiState, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val look = MascotLook(state.mascotId, state.mascotColor, state.mascotAccessory)
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TmlAndroidRadius.Card))
            .background(c.surface)
            .padding(TmlSpacing.Space4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space4),
    ) {
        // Decorative: the name beside it says which mascot it is.
        MascotOnHalo(look = look, halo = 100.dp, mascot = 104.dp, modifier = Modifier.size(112.dp).clearAndSetSemantics { })
        Column(Modifier.weight(1f)) {
            Text(stringResource(mascotNameRes(state.mascotId)), style = AppType.title, color = c.ink)
            Text(
                stringResource(R.string.home_marker),
                style = AppType.supporting,
                color = c.inkSecondary,
                modifier = Modifier.padding(top = 2.dp, bottom = 10.dp),
            )
            if (state.live) {
                StatusPill(stringResource(R.string.status_sharing_live), kind = PillKind.Sharer)
            } else {
                StatusPill(stringResource(R.string.status_not_sharing))
            }
        }
    }
}

private val Greeting.label: Int
    get() = when (this) {
        Greeting.Morning -> R.string.home_morning
        Greeting.Afternoon -> R.string.home_afternoon
        Greeting.Evening -> R.string.home_evening
    }

private class HomeStates : PreviewParameterProvider<HomeUiState> {
    override val values = sequenceOf(
        HomeUiState(greeting = Greeting.Evening, name = "Alex", loaded = true),
        HomeUiState(greeting = Greeting.Morning, name = "Alexandria Montgomery-W", loaded = true, mascotId = MascotId.NEKO, mascotColor = MascotColor.LAGOON),
        HomeUiState(greeting = Greeting.Evening, name = "Alex", loaded = true, live = true, liveWith = "Mom"),
    )
}

@ScreenPreviews
@Composable
private fun HomeScreenPreview(@PreviewParameter(HomeStates::class) state: HomeUiState) {
    PreviewTheme {
        Column(Modifier.background(TmlTheme.colors.ground)) { HomeScreen(state) }
    }
}
