package live.trackme.app.ui.ended

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import live.trackme.app.R
import live.trackme.app.di.appContainer
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.ButtonVariant
import live.trackme.app.ui.components.LayoutDefaults
import live.trackme.app.ui.components.ListGroup
import live.trackme.app.ui.components.ListRowSurface
import live.trackme.app.ui.components.PersonRowDefaults
import live.trackme.app.ui.components.PrimaryButton
import live.trackme.app.ui.components.TmlButton
import live.trackme.app.ui.components.tabular
import live.trackme.app.ui.mascot.MascotImage
import live.trackme.app.ui.permission.rememberLocationGate
import live.trackme.app.ui.share.ShareFormats
import live.trackme.app.ui.share.rememberShareFormats
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.EndReason

/**
 * The ended screen's route. Share again (at the limit) goes through the location gate first, since
 * Only this time lasts for one share.
 */
@Composable
fun EndedRoute(onDone: () -> Unit, onShareAgain: () -> Unit) {
    val vm: EndedViewModel = viewModel(factory = EndedViewModel.factory(LocalContext.current.appContainer))
    val state by vm.state.collectAsStateWithLifecycle()
    val gate = rememberLocationGate(onGranted = onShareAgain)
    EndedScreen(state = state, onDone = onDone, onShareAgain = gate::start)
}

/**
 * Sharing ended (prototype › viewEnded): the mascot in a dashed ring, why it ended, who it was shared
 * with, for how long, whether the link was opened and shared back, and when the points are deleted.
 * At the 1-hour limit, Share again leads and Done follows; otherwise Done alone. The title is the
 * pane title, so TalkBack announces it once as the screen appears.
 */
@Composable
fun EndedScreen(state: EndedUiState, onDone: () -> Unit, onShareAgain: () -> Unit, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val formats = rememberShareFormats()
    val title = stringResource(if (state.offersShareAgain) R.string.ended_title_limit else R.string.ended_title)
    BoxWithConstraints(
        modifier
            .fillMaxSize()
            .background(c.ground)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .semantics { paneTitle = title },
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier
                .widthIn(max = LayoutDefaults.ContentMaxWidth)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(horizontal = TmlSpacing.Space4, vertical = TmlSpacing.Space4),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Spacer(Modifier.height(0.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                EndedArt(state)
                Text(
                    text = title,
                    style = AppType.appBar,
                    color = c.ink,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = TmlSpacing.Space1).semantics { heading() },
                )
                Text(
                    text = why(state, formats),
                    style = AppType.body,
                    color = c.inkSecondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = TmlSpacing.Space2),
                )
                Summary(state, formats, Modifier.padding(top = TmlSpacing.Space5))
                Text(
                    text = stringResource(R.string.ended_deleted, formats.clock(state.endedAtMillis + DAY_MILLIS)),
                    style = AppType.fine,
                    color = c.inkSecondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                )
            }
            Column(Modifier.padding(top = TmlSpacing.Space6)) {
                if (state.offersShareAgain) {
                    PrimaryButton(text = stringResource(R.string.ended_share_again), onClick = onShareAgain, icon = R.drawable.ic_near_me_filled)
                    TmlButton(
                        text = stringResource(R.string.ended_done),
                        onClick = onDone,
                        variant = ButtonVariant.Plain,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = TmlSpacing.Space2),
                    )
                } else {
                    PrimaryButton(text = stringResource(R.string.ended_done), onClick = onDone)
                }
            }
        }
    }
}

/** The share's mascot, faded, in a dashed ring (prototype `.a-ended-art`). Decorative. */
@Composable
private fun EndedArt(state: EndedUiState) {
    val ring = TmlTheme.colors.inkTertiary.copy(alpha = 0.6f)
    Box(
        Modifier
            .height(168.dp)
            .fillMaxWidth()
            .clearAndSetSemantics { },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(156.dp).drawBehind {
                val w = 3.dp.toPx()
                val dash = 8.dp.toPx()
                drawCircle(ring, radius = size.minDimension / 2 - w / 2, style = Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash * 0.75f))))
            },
        )
        MascotImage(look = state.look, size = 124.dp, alpha = 0.85f, flatWhileLoading = true)
    }
}

/** Why it ended, in one line (prototype `endedWhy`). */
@Composable
private fun why(state: EndedUiState, formats: ShareFormats): String = when (state.reason) {
    EndReason.LIMIT -> stringResource(R.string.ended_why_limit)
    EndReason.CALL -> stringResource(R.string.ended_why_call)
    EndReason.TIMER -> stringResource(R.string.ended_why_timer)
    EndReason.STOPPED -> stringResource(R.string.ended_why_stopped, formats.clock(state.endedAtMillis))
}

@Composable
private fun Summary(state: EndedUiState, formats: ShareFormats, modifier: Modifier = Modifier) {
    val name = state.audience.name
    val inSentence = state.audience.inSentence
    ListGroup(modifier) {
        if (name != null) SummaryRow(stringResource(R.string.ended_shared_with), name)
        SummaryRow(stringResource(R.string.ended_shared_for), formats.duration(state.endedAtMillis - state.startedAtMillis))
        SummaryRow(
            if (inSentence != null) stringResource(R.string.ended_opened_named, inSentence) else stringResource(R.string.ended_opened),
            state.openedAtMillis?.let(formats::clock) ?: stringResource(R.string.ended_not_opened),
        )
        SummaryRow(
            if (inSentence != null) stringResource(R.string.ended_shared_back_named, inSentence) else stringResource(R.string.ended_shared_back),
            stringResource(if (state.sharedBack) R.string.ended_yes else R.string.ended_no),
        )
    }
}

/** A label and its value, read together. At accessibility text sizes the value moves under the label. */
@Composable
private fun SummaryRow(label: String, value: String) {
    val c = TmlTheme.colors
    val stack = LocalDensity.current.fontScale >= PersonRowDefaults.STACK_FONT_SCALE
    val valueStyle = AppType.card.copy(fontWeight = FontWeight.W700).tabular()
    ListRowSurface(Modifier.heightIn(min = 52.dp).semantics(mergeDescendants = true) { }) {
        val padding = Modifier.padding(start = TmlSpacing.Space4, end = TmlSpacing.Space5, top = TmlSpacing.Space2, bottom = TmlSpacing.Space2)
        if (stack) {
            Column(padding) {
                Text(label, style = AppType.card, color = c.inkSecondary)
                Text(value, style = valueStyle, color = c.ink)
            }
        } else {
            Row(padding, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space4)) {
                Text(label, style = AppType.card, color = c.inkSecondary, modifier = Modifier.weight(1f))
                Text(value, style = valueStyle, color = c.ink, textAlign = TextAlign.End, modifier = Modifier.weight(1f, fill = false))
            }
        }
    }
}

private const val DAY_MILLIS = 24 * 60 * 60_000L
