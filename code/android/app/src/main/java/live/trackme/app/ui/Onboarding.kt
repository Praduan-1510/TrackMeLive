package live.trackme.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.design.TmlTheme

/**
 * Onboarding, page 1 of 3 (prototype/js/android.js › viewOnboarding): the fox on a lamplight halo,
 * the promise in one sentence, and Continue. The text scrolls at large font sizes while the dots
 * and Continue stay pinned, so the action is always reachable.
 */
@Composable
fun OnboardingScreen(onContinue: () -> Unit, onSkip: () -> Unit) {
    val c = TmlTheme.colors
    Column(
        Modifier
            .fillMaxSize()
            .background(c.ground)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Row(
            Modifier.fillMaxWidth().height(64.dp).padding(start = 4.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = onSkip, colors = ButtonDefaults.textButtonColors(contentColor = c.ink)) {
                Text(stringResource(R.string.ob_skip), style = AppType.button)
            }
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            MascotOnHalo(
                modifier = Modifier.fillMaxWidth().height(300.dp),
                halo = 300.dp,
                mascot = 250.dp,
                bob = true,
            )
            Text(
                text = stringResource(R.string.ob_title),
                style = AppType.obTitle,
                color = c.ink,
                modifier = Modifier.padding(top = 4.dp).semantics { heading() },
            )
            Text(
                text = stringResource(R.string.ob_body),
                style = AppType.body,
                color = c.inkSecondary,
                modifier = Modifier.padding(top = 12.dp),
            )
            Spacer(Modifier.height(24.dp))
        }

        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 36.dp)) {
            PageDots(
                count = 3,
                current = 0,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 20.dp),
            )
            PrimaryButton(text = stringResource(R.string.ob_continue), onClick = onContinue)
        }
    }
}

/** Page dots: the current page is a 24dp lamplight capsule. Visual only, like the prototype's. */
@Composable
private fun PageDots(count: Int, current: Int, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    Row(
        modifier.heightIn(min = 8.dp).clearAndSetSemantics { },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { i ->
            val on = i == current
            Box(
                Modifier
                    .size(width = if (on) 24.dp else 8.dp, height = 8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(if (on) c.lamplight else c.inkTertiary.copy(alpha = 0.35f)),
            )
        }
    }
}
