package live.trackme.app.ui.onboarding

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.PreviewParameter
import androidx.compose.ui.tooling.preview.PreviewParameterProvider
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.ButtonVariant
import live.trackme.app.ui.components.MotionDurations
import live.trackme.app.ui.components.PreviewTheme
import live.trackme.app.ui.components.PrimaryButton
import live.trackme.app.ui.components.ScreenPreviews
import live.trackme.app.ui.components.TmlButton
import live.trackme.app.ui.components.emphasizedSpec
import live.trackme.app.ui.components.rememberReduceMotion
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.mascot.MascotOnHalo
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** The three onboarding pages (prototype/js/android.js › viewOnboarding). */
private enum class OnboardingPage(@StringRes val title: Int) {
    Promise(R.string.ob_title),
    LiveTogether(R.string.onboarding_live_together_title),
    Private(R.string.onboarding_private_title),
}

private const val PAGE_COUNT = 3

/**
 * Onboarding: what the app does, Live Together, and what stays private. Continue (or a swipe) moves
 * on, Get started on the last page and Skip on the others go to sign-up, and Back steps back a page.
 * At large font sizes each page's text scrolls while the dots and the button stay pinned, so the
 * action is always reachable.
 */
@Composable
fun OnboardingScreen(initialPage: Int, onFinish: () -> Unit, modifier: Modifier = Modifier) {
    val pager = rememberPagerState(initialPage = initialPage.coerceIn(0, PAGE_COUNT - 1)) { PAGE_COUNT }
    val scope = rememberCoroutineScope()
    val last = pager.currentPage == PAGE_COUNT - 1
    BackHandler(enabled = pager.currentPage > 0) {
        scope.launch { pager.animateScrollToPage(pager.currentPage - 1) }
    }

    Column(
        modifier
            .fillMaxSize()
            .background(TmlTheme.colors.ground)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Row(
            Modifier.fillMaxWidth().height(64.dp).padding(start = 4.dp, end = TmlSpacing.Space2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.End,
        ) {
            if (!last) {
                TmlButton(text = stringResource(R.string.ob_skip), onClick = onFinish, variant = ButtonVariant.Plain)
            }
        }

        HorizontalPager(
            state = pager,
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.Top,
        ) { index ->
            PageContent(OnboardingPage.entries[index])
        }

        Column(
            Modifier
                .fillMaxWidth()
                .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, bottom = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            PageDots(pager, Modifier.padding(bottom = TmlSpacing.Space5))
            PrimaryButton(
                text = stringResource(if (last) R.string.onboarding_get_started else R.string.ob_continue),
                onClick = {
                    if (last) onFinish() else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) }
                },
                modifier = Modifier.widthIn(max = 560.dp),
            )
        }
    }
}

@Composable
private fun PageContent(page: OnboardingPage) {
    val c = TmlTheme.colors
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = TmlSpacing.Space4),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // The art is an illustration: the words below say what it shows, so TalkBack skips it.
        Box(
            Modifier.fillMaxWidth().height(300.dp).clearAndSetSemantics { },
            contentAlignment = Alignment.Center,
        ) {
            when (page) {
                OnboardingPage.Promise -> MascotOnHalo(look = MascotLook(), halo = 300.dp, mascot = 250.dp, bob = true)
                OnboardingPage.LiveTogether -> LiveTogetherArt()
                OnboardingPage.Private -> {
                    Box(Modifier.size(300.dp).clip(RoundedCornerShape(50)).background(c.lamplightHalo))
                    BrandMark(Modifier.size(width = 140.dp, height = 163.dp))
                }
            }
        }
        Column(Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
            Text(
                text = stringResource(page.title),
                style = AppType.obTitle,
                color = c.ink,
                modifier = Modifier.padding(top = 4.dp).semantics { heading() },
            )
            when (page) {
                OnboardingPage.Promise -> Body(R.string.ob_body)
                OnboardingPage.LiveTogether -> Body(R.string.onboarding_live_together_body)
                OnboardingPage.Private -> PrivacyPoints()
            }
            Spacer(Modifier.height(TmlSpacing.Space6))
        }
    }
}

@Composable
private fun Body(@StringRes text: Int) {
    Text(
        text = stringResource(text),
        style = AppType.body,
        color = TmlTheme.colors.inkSecondary,
        modifier = Modifier.padding(top = TmlSpacing.Space3),
    )
}

/** Private by default: three promises, each with its icon (prototype `.a-ob-list`). */
@Composable
private fun PrivacyPoints() {
    val points = listOf(
        R.drawable.ic_shield to R.string.onboarding_private_share,
        R.drawable.ic_schedule to R.string.onboarding_private_stops,
        R.drawable.ic_delete to R.string.onboarding_private_deleted,
    )
    Column(Modifier.padding(top = TmlSpacing.Space5), verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space4)) {
        points.forEach { (icon, text) -> PrivacyPoint(icon, text) }
    }
}

@Composable
private fun PrivacyPoint(@DrawableRes icon: Int, @StringRes text: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space4)) {
        Icon(painterResource(icon), contentDescription = null, tint = TmlTheme.colors.lamplightText, modifier = Modifier.size(24.dp))
        Text(stringResource(text), style = AppType.body, color = TmlTheme.colors.ink, modifier = Modifier.weight(1f))
    }
}

/**
 * Page dots: the current page is a 24dp lamplight capsule. TalkBack reads them as one "Page 2 of 3"
 * so the position is never shown by color and size alone.
 */
@Composable
private fun PageDots(pager: PagerState, modifier: Modifier = Modifier) {
    val position = stringResource(R.string.onboarding_page_of, pager.currentPage + 1, PAGE_COUNT)
    Row(
        modifier.clearAndSetSemantics { contentDescription = position },
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(PAGE_COUNT) { i -> Dot(on = i == pager.currentPage) }
    }
}

@Composable
private fun Dot(on: Boolean) {
    val c = TmlTheme.colors
    val reduceMotion = rememberReduceMotion()
    val width by animateDpAsState(
        targetValue = if (on) 24.dp else 8.dp,
        animationSpec = emphasizedSpec(MotionDurations.Long, reduceMotion),
        label = "dotWidth",
    )
    val color by animateColorAsState(
        targetValue = if (on) c.lamplight else c.inkTertiary.copy(alpha = 0.35f),
        animationSpec = emphasizedSpec(MotionDurations.Long, reduceMotion),
        label = "dotColor",
    )
    Box(Modifier.size(width = width, height = 8.dp).clip(RoundedCornerShape(4.dp)).background(color))
}

private class Pages : PreviewParameterProvider<Int> {
    override val values = sequenceOf(0, 1, 2)
}

@ScreenPreviews
@Composable
private fun OnboardingPreview(@PreviewParameter(Pages::class) page: Int) {
    PreviewTheme { OnboardingScreen(initialPage = page, onFinish = {}) }
}
