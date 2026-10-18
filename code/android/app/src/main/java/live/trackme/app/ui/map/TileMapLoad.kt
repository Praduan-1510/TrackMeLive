package live.trackme.app.ui.map

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Why the live map draws its keyless map instead of the tile map. */
enum class MapFallback {
    /** No connection when the map started: nothing to load tiles over. */
    Offline,

    /** The style (or its sources) failed to load: the host is down, moved or refused it. */
    StyleFailed,

    /** Nothing failed outright, but the map wasn't drawn within the load timeout. */
    TimedOut,

    /** The renderer failed on this phone. */
    RenderFailed,
}

/** Where the tile map's load stands. */
sealed interface TileMapState {
    data object Loading : TileMapState

    /** Drawn: the style and the tiles in view have loaded. */
    data object Ready : TileMapState

    data class Fallback(val reason: MapFallback, val detail: String? = null) : TileMapState
}

/**
 * The live map's load (closes the backlog's "a refused key shows an empty map"): the tile map gets
 * [TileLiveMap.LOAD_TIMEOUT_MS] to draw, and anything short of that, or no connection at the start,
 * means the keyless map instead. OpenFreeMap is donation-run with no uptime promise, so this is the
 * normal path when it's down.
 *
 * - Offline at the start, or the connection dropping before the map is drawn: [MapFallback.Offline].
 * - The style failing: [MapFallback.StyleFailed]. The renderer failing, even once drawn: [MapFallback.RenderFailed].
 * - The timeout: [MapFallback.TimedOut]. The map keeps loading underneath, and if it's drawn after all
 *   it takes over (a slow first load on a slow network shouldn't cost the whole share).
 * - A connection coming back after [MapFallback.Offline], [MapFallback.StyleFailed] or
 *   [MapFallback.TimedOut] tries again with a fresh map ([attempt]). A drawn map stays: the tiles
 *   already loaded stay on screen offline, and switching to the keyless map mid-share would only lose them.
 *
 * State is Compose state, read by the live map and written from the map's listeners on the main thread.
 */
class TileMapLoad(online: Boolean) {
    var state: TileMapState by mutableStateOf(if (online) TileMapState.Loading else TileMapState.Fallback(MapFallback.Offline))
        private set

    /** Bumped on every retry: the live map builds a new map view for each attempt. */
    var attempt: Int by mutableIntStateOf(0)
        private set

    private var styleLoaded = false
    private var tileErrors = 0
    private var online = online

    /** Whether the map view should exist: loading, drawn, or still loading underneath after the timeout. */
    val keepsMap: Boolean
        get() = when (val s = state) {
            TileMapState.Loading, TileMapState.Ready -> true
            is TileMapState.Fallback -> s.reason == MapFallback.TimedOut
        }

    fun onStyleLoaded() {
        styleLoaded = true
    }

    /** The style and every tile in view have loaded (MapLibre's finished loading, or rendered fully). */
    fun onMapDrawn() {
        if (keepsMap) state = TileMapState.Ready
    }

    fun onStyleFailed(message: String?) {
        if (state != TileMapState.Ready && keepsMap) state = TileMapState.Fallback(MapFallback.StyleFailed, message)
    }

    /** A tile failed to load; the timeout decides, and says how many did. */
    fun onTileError() {
        tileErrors++
    }

    fun onRenderError() {
        state = TileMapState.Fallback(MapFallback.RenderFailed)
    }

    fun onTimeout() {
        if (state != TileMapState.Loading) return
        val detail = if (!styleLoaded) "the style didn't load" else "tiles didn't load ($tileErrors failed)"
        state = TileMapState.Fallback(MapFallback.TimedOut, detail)
    }

    fun onConnectivity(isOnline: Boolean) {
        val regained = isOnline && !online
        online = isOnline
        val s = state
        when {
            !isOnline && s == TileMapState.Loading -> state = TileMapState.Fallback(MapFallback.Offline)
            regained && s is TileMapState.Fallback && s.reason != MapFallback.RenderFailed -> retry()
        }
    }

    private fun retry() {
        styleLoaded = false
        tileErrors = 0
        attempt++
        state = TileMapState.Loading
    }
}
