package live.trackme.app.ui.mascot

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.ChoiceChipGroup
import live.trackme.app.ui.components.LayoutDefaults
import live.trackme.app.ui.components.PreviewTheme
import live.trackme.app.ui.components.PrimaryButton
import live.trackme.app.ui.components.ScreenPreviews
import live.trackme.app.ui.components.SegmentedControl
import live.trackme.app.ui.components.TmlLargeTopAppBar
import live.trackme.app.ui.components.iconSizeFor
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlColorTokens
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.MascotSet

/** Where the picker is shown, which decides its action and whether the navigation bar is under it. */
enum class MascotPickerMode {
    /** Right after sign-up, before the shell: "Continue", no navigation bar. */
    Setup,

    /** The Mascot tab: "Save", pinned above the navigation bar. */
    Tab,
}

/** Sizes from the prototype's picker (`.a-stage`, `.a-pick`, `.a-swatch`, `.pick-check`). */
object MascotPickerDefaults {
    /** The stage band that holds the halo and the bobbing mascot. */
    val StageHeight: Dp = 176.dp

    /** The halo and the mascot on the stage. */
    val Stage: Dp = 160.dp

    /** A character's render inside its tile. */
    val TileArt: Dp = 60.dp

    /** The narrowest a tile gets before the grid drops to fewer columns. */
    val TileMinWidth: Dp = 72.dp

    /** The unselected tile's outline. */
    val TileBorder: Dp = 1.dp

    /** The selected tile's `lamplight-text` outline (5.72:1 on surface). */
    val TileSelectedBorder: Dp = 2.dp

    /** The check badge on the selected tile, and the check inside it. */
    val CheckBadge: Dp = 20.dp
    val CheckIcon: Dp = 14.dp

    /** A color swatch: a 48dp target. */
    val Swatch: Dp = 48.dp

    /** The selected swatch's ring: a `ground` gap, then an `ink` ring, outside the swatch. */
    val SwatchRingGap: Dp = 3.dp
    val SwatchRing: Dp = 2.dp

    /** The check on the selected swatch. */
    val SwatchCheck: Dp = 24.dp

    /** The swatch's own hairline, so light swatches hold their edge on surface. */
    val SwatchEdge: Dp = 1.dp

    /** Columns of the character grid at 100% font size; it drops to 2, then 1, as names grow. */
    const val MAX_COLUMNS = 4
}

/**
 * The mascot picker (prototype › viewPicker, Android): the stage, then Character (the three sets and
 * their four characters), Color and Accessory, with Save (or Continue during setup) pinned at the
 * bottom. Nothing is saved until that button: [onSave] gets the character, its color and the
 * accessory (null for none). While [saving], the button shows progress; [errorMessage] shows above it.
 * Pass a [snackbarHost] to show snackbars above the pinned button rather than over it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MascotPickerScreen(
    initial: MascotLook,
    mode: MascotPickerMode,
    onSave: (MascotId, MascotColor, MascotAccessory?) -> Unit,
    modifier: Modifier = Modifier,
    saving: Boolean = false,
    errorMessage: String? = null,
    snackbarHost: @Composable () -> Unit = {},
    state: MascotPickerState = rememberMascotPickerState(initial),
) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior(rememberTopAppBarState())
    PrefetchTiles(state.look.color)
    Scaffold(
        modifier = modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        containerColor = TmlTheme.colors.ground,
        snackbarHost = snackbarHost,
        topBar = { TmlLargeTopAppBar(title = stringResource(R.string.picker_title), scrollBehavior = scrollBehavior) },
        bottomBar = {
            PickerBottomBar(
                label = stringResource(if (mode == MascotPickerMode.Setup) R.string.picker_continue else R.string.picker_save),
                saving = saving,
                errorMessage = errorMessage,
                onClick = { state.look.let { onSave(it.id, it.color, it.accessory) } },
            )
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding)
                .verticalScroll(rememberScrollState()),
            contentAlignment = Alignment.TopCenter,
        ) {
            PickerContent(
                state = state,
                modifier = Modifier
                    .widthIn(max = LayoutDefaults.ContentMaxWidth)
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
                    .padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, bottom = TmlSpacing.Space6),
            )
        }
    }
}

@Composable
private fun PickerContent(state: MascotPickerState, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val look = state.look
    Column(modifier.fillMaxWidth()) {
        Text(stringResource(R.string.picker_lede), style = AppType.body, color = c.inkSecondary)
        MascotOnHalo(
            look = look,
            halo = MascotPickerDefaults.Stage,
            mascot = MascotPickerDefaults.Stage,
            bob = true,
            contentDescription = stageLabel(look),
            modifier = Modifier.fillMaxWidth().height(MascotPickerDefaults.StageHeight),
        )

        PickerLabel(stringResource(R.string.picker_character))
        val sets = MascotSet.entries
        SegmentedControl(
            labels = sets.map { stringResource(mascotSetNameRes(it)) },
            selectedIndex = sets.indexOf(state.shownSet),
            onSelect = { state.showSet(sets[it]) },
        )
        CharacterGrid(
            characters = mascotsIn(state.shownSet),
            selected = look.id,
            color = look.color,
            onPick = state::pickMascot,
            modifier = Modifier.padding(top = TmlSpacing.Space3),
        )

        PickerLabel(stringResource(R.string.picker_color))
        SwatchRow(id = look.id, selected = look.color, onPick = state::pickColor)

        PickerLabel(stringResource(R.string.picker_accessory))
        val accessories = look.accessories
        if (accessories.isEmpty()) {
            val name = stringResource(mascotNameRes(look.id))
            Text(
                text = if (look.id == MascotId.ASTRONAUT) {
                    stringResource(R.string.picker_no_accessories_astronaut)
                } else {
                    stringResource(R.string.picker_no_accessories, name)
                },
                style = AppType.supporting,
                color = c.inkSecondary,
                modifier = Modifier.padding(horizontal = TmlSpacing.Space1),
            )
        } else {
            val options = listOf<MascotAccessory?>(null) + accessories
            ChoiceChipGroup(
                labels = options.map { stringResource(mascotAccessoryNameRes(it)) },
                selectedIndex = options.indexOf(look.accessory),
                onSelect = { state.pickAccessory(options[it]) },
            )
        }
    }
}

/** "Fox, Lagoon, Headphones": what the stage shows, for TalkBack. */
@Composable
private fun stageLabel(look: MascotLook): String {
    val name = stringResource(mascotNameRes(look.id))
    val color = stringResource(mascotColorNameRes(look.color))
    return if (look.accessory == null) {
        stringResource(R.string.picker_stage_label, name, color)
    } else {
        stringResource(R.string.picker_stage_label_accessory, name, color, stringResource(mascotAccessoryNameRes(look.accessory)))
    }
}

@Composable
private fun PickerLabel(text: String) {
    Text(
        text = text,
        style = AppType.section,
        color = TmlTheme.colors.inkSecondary,
        modifier = Modifier
            .padding(start = TmlSpacing.Space1, end = TmlSpacing.Space1, top = TmlSpacing.Space5, bottom = TmlSpacing.Space2)
            .semantics { heading() },
    )
}

/**
 * The four characters of a set as tiles. Four columns while the longest name fits a tile; at large
 * text the grid drops to two columns, then one, so a name never truncates.
 */
@Composable
private fun CharacterGrid(
    characters: List<MascotId>,
    selected: MascotId,
    color: MascotColor,
    onPick: (MascotId) -> Unit,
    modifier: Modifier = Modifier,
) {
    val style = tileLabelStyle()
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val names = characters.map { stringResource(mascotNameRes(it)) }
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val gap = TmlSpacing.Space2
        val tileWidth = remember(names, style, density, measurer) {
            val widest = names.maxOf { measurer.measure(it, style, softWrap = false, maxLines = 1).size.width }
            with(density) { maxOf(MascotPickerDefaults.TileMinWidth, widest.toDp() + TmlSpacing.Space2 * 2) }
        }
        val columns = generateSequence(MascotPickerDefaults.MAX_COLUMNS) { it / 2 }
            .takeWhile { it >= 1 }
            .firstOrNull { tileWidth * it + gap * (it - 1) <= maxWidth } ?: 1
        Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(gap)) {
            characters.zip(names).chunked(columns).forEach { row ->
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    row.forEach { (id, name) ->
                        CharacterTile(
                            id = id,
                            name = name,
                            color = color,
                            selected = id == selected,
                            onClick = { onPick(id) },
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        )
                    }
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun tileLabelStyle() = TmlTheme.type.footnote.copy(fontWeight = FontWeight.W600)

@Composable
private fun CharacterTile(
    id: MascotId,
    name: String,
    color: MascotColor,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = TmlTheme.colors
    val d = MascotPickerDefaults
    val shape = RoundedCornerShape(TmlAndroidRadius.ListOuter)
    Box(modifier) {
        Column(
            Modifier
                .fillMaxSize()
                .clip(shape)
                .background(if (selected) c.lamplightWash else c.surface)
                .border(
                    width = if (selected) d.TileSelectedBorder else d.TileBorder,
                    color = if (selected) c.lamplightText else c.separator,
                    shape = shape,
                )
                .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
                .padding(start = TmlSpacing.Space1, end = TmlSpacing.Space1, top = TmlSpacing.Space2, bottom = TmlSpacing.Space3),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space1),
        ) {
            MascotImage(look = MascotLook(id, color), size = d.TileArt)
            Text(name, style = tileLabelStyle(), color = c.ink, textAlign = TextAlign.Center)
        }
        if (selected) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = -TmlSpacing.Space1, y = TmlSpacing.Space1)
                    .size(d.CheckBadge)
                    .clip(CircleShape)
                    .background(c.lamplight),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_check),
                    contentDescription = null,
                    tint = c.onLamplight,
                    modifier = Modifier.size(d.CheckIcon),
                )
            }
        }
    }
}

/** The five colors. Each swatch is a 48dp target; the selected one gets a ring and a check. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SwatchRow(id: MascotId, selected: MascotColor, onPick: (MascotColor) -> Unit) {
    val c = TmlTheme.colors
    val d = MascotPickerDefaults
    FlowRow(
        modifier = Modifier.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
        verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
    ) {
        MascotColor.entries.forEach { color ->
            val on = color == selected
            val fill = colorResource(mascotSwatchRes(id, color))
            val name = stringResource(mascotColorNameRes(color))
            Box(
                Modifier
                    .size(d.Swatch)
                    .drawBehind {
                        if (on) {
                            val ring = d.SwatchRing.toPx()
                            drawCircle(
                                color = c.ink,
                                radius = size.minDimension / 2 + d.SwatchRingGap.toPx() + ring / 2,
                                center = Offset(size.width / 2, size.height / 2),
                                style = Stroke(width = ring),
                            )
                        }
                    }
                    .clip(CircleShape)
                    .background(fill)
                    .border(d.SwatchEdge, c.separator, CircleShape)
                    .selectable(selected = on, role = Role.RadioButton, onClick = { onPick(color) })
                    .semantics { contentDescription = name },
                contentAlignment = Alignment.Center,
            ) {
                if (on) {
                    Icon(
                        painter = painterResource(R.drawable.ic_check),
                        contentDescription = null,
                        tint = checkOn(fill),
                        modifier = Modifier.size(d.SwatchCheck),
                    )
                }
            }
        }
    }
}

/** The check that reads best on a swatch: dark ink on light colors, white on dark ones (ninja, ace, agent). */
private fun checkOn(fill: Color): Color {
    val dark = TmlColorTokens.OnLamplightLight
    val light = TmlColorTokens.SurfaceLight
    return if (contrast(dark, fill) >= contrast(light, fill)) dark else light
}

private fun contrast(a: Color, b: Color): Float {
    val la = a.luminance() + CONTRAST_OFFSET
    val lb = b.luminance() + CONTRAST_OFFSET
    return maxOf(la, lb) / minOf(la, lb)
}

/** WCAG's flare term in the contrast ratio. */
private const val CONTRAST_OFFSET = 0.05f

/** Save or Continue, pinned at the bottom on `ground` with a hairline above, over the navigation bar. */
@Composable
private fun PickerBottomBar(label: String, saving: Boolean, errorMessage: String?, onClick: () -> Unit) {
    val c = TmlTheme.colors
    val hairline = LayoutDefaults.Hairline
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.ground)
            .drawBehind { drawLine(c.separator, Offset(0f, 0f), Offset(size.width, 0f), hairline.toPx()) }
            .windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)))
            .padding(horizontal = TmlSpacing.Space4, vertical = TmlSpacing.Space3),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
    ) {
        if (errorMessage != null) {
            Row(
                Modifier
                    .widthIn(max = LayoutDefaults.ContentMaxWidth)
                    .fillMaxWidth()
                    .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_error_filled),
                    contentDescription = null,
                    tint = c.ink,
                    modifier = Modifier.size(iconSizeFor(LayoutDefaults.InlineIcon, AppType.supporting)),
                )
                Text(errorMessage, style = AppType.supporting, color = c.ink)
            }
        }
        PrimaryButton(
            text = label,
            onClick = onClick,
            loading = saving,
            modifier = Modifier.widthIn(max = LayoutDefaults.ContentMaxWidth),
        )
    }
}

/** Decodes every character's tile in the chosen color ahead of time, so switching sets never flashes. */
@Composable
private fun PrefetchTiles(color: MascotColor) {
    val resources = LocalResources.current
    val px = with(LocalDensity.current) { MascotPickerDefaults.TileArt.roundToPx() }
    LaunchedEffect(color, px) {
        withContext(Dispatchers.IO) {
            MascotId.entries.forEach { MascotBitmaps.loadFirst(resources, renderCandidates(it, color), px) }
        }
    }
}

@ScreenPreviews
@Composable
private fun MascotPickerPreview() {
    PreviewTheme {
        MascotPickerScreen(
            initial = MascotLook(MascotId.FOX, MascotColor.ORIGINAL, MascotAccessory.HEADPHONES),
            mode = MascotPickerMode.Tab,
            onSave = { _, _, _ -> },
        )
    }
}
