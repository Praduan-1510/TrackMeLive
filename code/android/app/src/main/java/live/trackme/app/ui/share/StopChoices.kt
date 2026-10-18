package live.trackme.app.ui.share

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.launch
import live.trackme.app.R
import live.trackme.app.data.sharing.SessionView
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.ui.components.RadioRow
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.DefaultStop
import live.trackme.schema.StopMinutes
import live.trackme.schema.StopRule

/**
 * When a share stops, as the share screen's Stops row and the timer sheet offer it (FSD §4 Stop rule;
 * prototype `stopOptions`). Every Sprint 2 share is manual, so When the call ends is never offered:
 * it slots in here, first in each list, once the app follows calls.
 */
object StopChoices {
    /** Before sharing: In 15 min, In 30 min, In 1 hour. */
    val beforeSharing: List<StopChoice> = StopMinutes.entries.map { StopChoice.After(it) }

    /**
     * While sharing: the timers that would still end before the 1-hour limit, counted from [nowMillis],
     * then At the 1-hour limit.
     */
    fun whileSharing(nowMillis: Long, expiresAtMillis: Long): List<StopChoice> =
        StopMinutes.entries
            .filter { nowMillis + it.minutes * 60_000L < expiresAtMillis }
            .map { StopChoice.After(it) } + StopChoice.AtLimit

    /** The choice a share starts with, from Settings › Default stop time. Without a call, the call default is 30 minutes. */
    fun fromDefault(default: DefaultStop): StopChoice = when (default) {
        DefaultStop.CALL, DefaultStop.MINUTES_30 -> StopChoice.After(StopMinutes.MINUTES_30)
        DefaultStop.MINUTES_15 -> StopChoice.After(StopMinutes.MINUTES_15)
        DefaultStop.MINUTES_60 -> StopChoice.After(StopMinutes.MINUTES_60)
    }

    /**
     * The choice a running session holds. A timer whose end reaches the limit reads as the limit, since
     * that's when it ends (`stop_at` equal to `expires_at` means the limit; FSD §6).
     */
    fun ofSession(session: SessionView): StopChoice = when (session.stopRule) {
        StopRule.CALL -> StopChoice.WhenCallEnds
        StopRule.LIMIT -> StopChoice.AtLimit
        StopRule.MINUTES -> {
            val stopAt = session.stopAtMillis
            if (stopAt != null && stopAt >= session.expiresAtMillis) {
                StopChoice.AtLimit
            } else {
                StopChoice.After(session.stopMinutes ?: StopMinutes.MINUTES_30)
            }
        }
    }
}

/** "When the call ends", "In 15 min", "In 1 hour", "At the 1-hour limit · 10:38 pm". */
@Composable
fun stopLabel(choice: StopChoice, expiresAtMillis: Long?, formats: ShareFormats): String = when (choice) {
    StopChoice.WhenCallEnds -> stringResource(R.string.stop_call)
    StopChoice.AtLimit -> if (expiresAtMillis != null) {
        stringResource(R.string.stop_limit, formats.clock(expiresAtMillis))
    } else {
        stringResource(R.string.stop_limit_plain)
    }
    is StopChoice.After -> when (choice.minutes) {
        StopMinutes.MINUTES_15 -> stringResource(R.string.stop_15)
        StopMinutes.MINUTES_30 -> stringResource(R.string.stop_30)
        StopMinutes.MINUTES_60 -> stringResource(R.string.stop_60)
    }
}

/**
 * The timer sheet (prototype › topAlex, timer): "When sharing stops" over a radio choice per stop rule,
 * and "Sharing never runs longer than 1 hour." under them. Picking one closes the sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StopTimeSheet(
    options: List<StopChoice>,
    selected: StopChoice,
    expiresAtMillis: Long?,
    onPick: (StopChoice) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val formats = rememberShareFormats()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = TmlTheme.colors.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = TmlSpacing.Space6)) {
            Text(
                text = stringResource(R.string.stop_sheet_title),
                style = TmlTheme.type.title2,
                color = TmlTheme.colors.ink,
                modifier = Modifier
                    .padding(horizontal = TmlSpacing.Space6, vertical = TmlSpacing.Space2)
                    .semantics { heading() },
            )
            Column(Modifier.selectableGroup().padding(horizontal = TmlSpacing.Space2)) {
                options.forEach { choice ->
                    RadioRow(
                        text = stopLabel(choice, expiresAtMillis, formats),
                        selected = choice == selected,
                        onClick = {
                            onPick(choice)
                            scope.launch { sheetState.hide() }.invokeOnCompletion { if (!sheetState.isVisible) onDismiss() }
                        },
                    )
                }
            }
            Text(
                text = stringResource(R.string.stop_sheet_note),
                style = TmlTheme.type.footnote,
                color = TmlTheme.colors.inkSecondary,
                modifier = Modifier.padding(horizontal = TmlSpacing.Space6, vertical = TmlSpacing.Space2),
            )
        }
    }
}
