package live.trackme.app.ui.mascot

import android.content.res.Resources
import android.graphics.ImageDecoder
import android.util.LruCache
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import live.trackme.app.ui.components.ComponentPreviews
import live.trackme.app.ui.components.PreviewSurface
import live.trackme.app.ui.components.rememberReduceMotion
import live.trackme.design.TmlTheme
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId

/**
 * Decodes the 512 px mascot renders at the size they are drawn, off the main thread, and keeps them
 * in a small LRU cache, so a 32dp avatar costs a 32dp bitmap rather than a 512 px one.
 */
internal object MascotBitmaps {
    /** About ten stage-sized renders, or the whole picker grid several times over. */
    private const val MAX_BYTES = 8 * 1024 * 1024

    private val cache = object : LruCache<String, ImageBitmap>(MAX_BYTES) {
        override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * BYTES_PER_PIXEL
    }

    private const val BYTES_PER_PIXEL = 4

    private fun key(@DrawableRes res: Int, px: Int) = "$res@$px"

    fun cached(@DrawableRes res: Int, px: Int): ImageBitmap? = cache.get(key(res, px))

    /** Decodes [res] to [px] wide (never upscaled), or returns null when it can't be read. Blocking. */
    fun load(resources: Resources, @DrawableRes res: Int, px: Int): ImageBitmap? {
        cached(res, px)?.let { return it }
        val bitmap = try {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(resources, res)) { decoder, info, _ ->
                // Software memory: drawable in every canvas (previews, screenshots) and small at this size.
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val width = info.size.width
                if (px in 1 until width) decoder.setTargetSize(px, px * info.size.height / width)
            }.asImageBitmap()
        } catch (e: IOException) {
            null
        } catch (e: Resources.NotFoundException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }
        bitmap?.let { cache.put(key(res, px), it) }
        return bitmap
    }

    /** The first of [candidates] that decodes: the color render, then the Original render. */
    fun loadFirst(resources: Resources, candidates: List<Int>, px: Int): ImageBitmap? =
        candidates.firstNotNullOfOrNull { load(resources, it, px) }
}

/** Where a mascot image is in its fallback chain. */
@Immutable
internal sealed interface ArtState {
    data object Loading : ArtState

    data class Loaded(val bitmap: ImageBitmap) : ArtState

    data object Failed : ArtState
}

/** The renders to try for [look], best first: its color, then the Original render (prototype `mascotFail`). */
internal fun renderCandidates(id: MascotId, color: MascotColor): List<Int> =
    if (color == MascotColor.ORIGINAL) {
        listOf(MascotArtTable.render(id, MascotColor.ORIGINAL))
    } else {
        listOf(MascotArtTable.render(id, color), MascotArtTable.render(id, MascotColor.ORIGINAL))
    }

/**
 * Loads the first of [candidates] at [px]. Cached renders show at once; others decode on the IO
 * dispatcher. Previews decode in place, since they run no effects.
 */
@Composable
internal fun rememberArt(candidates: List<Int>, px: Int): ArtState {
    val resources = LocalResources.current
    val inPreview = LocalInspectionMode.current
    var state by remember(candidates, px) {
        val hit = candidates.firstNotNullOfOrNull { MascotBitmaps.cached(it, px) }
        val initial = when {
            hit != null -> ArtState.Loaded(hit)
            inPreview -> MascotBitmaps.loadFirst(resources, candidates, px)?.let { ArtState.Loaded(it) } ?: ArtState.Failed
            else -> ArtState.Loading
        }
        mutableStateOf(initial)
    }
    LaunchedEffect(candidates, px) {
        if (state is ArtState.Loading) {
            val bitmap = withContext(Dispatchers.IO) { MascotBitmaps.loadFirst(resources, candidates, px) }
            state = bitmap?.let { ArtState.Loaded(it) } ?: ArtState.Failed
        }
    }
    return state
}

/**
 * A mascot as people chose it: the render in its color with the accessory layered on top, in the
 * same box. If the color render can't load it falls back to the Original render, then to the flat
 * head (without the accessory, which only fits the renders). Decorative unless [contentDescription]
 * is given. With [flatWhileLoading] the flat head stands in until the render is ready, for markers
 * and avatars, which must never show an empty ring.
 */
@Composable
fun MascotImage(
    look: MascotLook,
    size: Dp,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    alpha: Float = 1f,
    flatWhileLoading: Boolean = false,
) {
    val px = with(LocalDensity.current) { size.roundToPx() }
    val candidates = remember(look.id, look.color) { renderCandidates(look.id, look.color) }
    val render = rememberArt(candidates, px)
    val accessoryRes = look.accessory?.let { MascotArtTable.accessory(look.id, it) }
    val layer = accessoryRes?.let { rememberArt(remember(it) { listOf(it) }, px) }
    val described = if (contentDescription != null) {
        Modifier.semantics {
            this.contentDescription = contentDescription
            role = Role.Image
        }
    } else {
        Modifier
    }
    Box(modifier.size(size).then(described)) {
        when (render) {
            is ArtState.Loaded -> {
                Image(render.bitmap, contentDescription = null, modifier = Modifier.fillMaxSize(), alpha = alpha)
                if (layer is ArtState.Loaded) {
                    Image(layer.bitmap, contentDescription = null, modifier = Modifier.fillMaxSize(), alpha = alpha)
                }
            }
            ArtState.Failed -> FlatHead(look.id, alpha)
            ArtState.Loading -> if (flatWhileLoading) FlatHead(look.id, alpha)
        }
    }
}

@Composable
private fun FlatHead(id: MascotId, alpha: Float) {
    Image(
        painter = painterResource(MascotArtTable.flat(id)),
        contentDescription = null,
        modifier = Modifier.fillMaxSize(),
        alpha = alpha,
    )
}

/** Sizes and motion of the mascot on its halo. */
object MascotHaloDefaults {
    /** The rise of the idle bob (prototype `bob`). */
    val BobLift: Dp = 3.dp

    /** Half a bob, up or down; 2.6 s for the whole cycle as in the prototype's picker stage. */
    const val BOB_HALF_MILLIS = 1300
}

/**
 * The mascot on a soft `lamplight-halo` disc, for onboarding, Home's card and the picker's stage.
 * With [bob] it rises 3dp and settles, slowly; Remove animations keeps it still.
 */
@Composable
fun MascotOnHalo(
    look: MascotLook,
    halo: Dp,
    mascot: Dp,
    modifier: Modifier = Modifier,
    bob: Boolean = false,
    contentDescription: String? = null,
) {
    val reduceMotion = rememberReduceMotion()
    val bobPx = with(LocalDensity.current) { MascotHaloDefaults.BobLift.toPx() }
    val lift = if (bob && !reduceMotion) {
        rememberInfiniteTransition(label = "bob").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(MascotHaloDefaults.BOB_HALF_MILLIS, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "bobLift",
        )
    } else {
        null
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(Modifier.size(halo).clip(CircleShape).background(TmlTheme.colors.lamplightHalo))
        MascotImage(
            look = look,
            size = mascot,
            contentDescription = contentDescription,
            modifier = Modifier.graphicsLayer { translationY = -(lift?.value ?: 0f) * bobPx },
        )
    }
}

@ComponentPreviews
@Composable
private fun MascotImagePreview() {
    PreviewSurface {
        MascotOnHalo(
            look = MascotLook(MascotId.FOX, MascotColor.LAGOON, MascotAccessory.HEADPHONES),
            halo = MascotPickerDefaults.Stage,
            mascot = MascotPickerDefaults.Stage,
        )
    }
}
