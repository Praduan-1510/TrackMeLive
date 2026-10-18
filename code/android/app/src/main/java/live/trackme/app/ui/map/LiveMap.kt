package live.trackme.app.ui.map

import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.Circle
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.rememberCameraPositionState
import live.trackme.app.ui.components.MarkerState
import live.trackme.app.ui.components.Person
import live.trackme.app.ui.components.PersonMarker
import live.trackme.app.ui.components.haloSize
import live.trackme.design.TmlTheme

/** One person on the live map. */
data class MapPerson(
    val person: Person,
    /** The point, or null before the first one (no marker yet). */
    val lat: Double?,
    val lng: Double?,
    /** "You", or "Last seen 9:41 pm". */
    val label: String,
    /** The marker's one phrase for TalkBack. */
    val description: String,
    val state: MarkerState,
    /** Changes with every ping: the marker bobs once. */
    val pingKey: Any?,
)

/**
 * The map behind the live screen (architecture doc: the Maps API draws the map in the app). With a Maps
 * key in this build it's Google Maps, centered on the sharer in the open band between [bandTop] and
 * [bandBottom] (the space the top bar and the sheet leave), with the approximate area as a 1 km circle.
 * Without a key, or in tests, it's the keyless street map with the marker in the middle of that band.
 * Either way the marker is our own: the mascot, its halo, its name capsule.
 */
@Composable
fun LiveMap(
    sharer: MapPerson,
    bandTop: Dp,
    bandBottom: Dp,
    mapLabel: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val hasKey = remember(context) { context.mapsApiKey() != null }
    if (LocalUseGoogleMap.current ?: hasKey) {
        GoogleLiveMap(sharer, bandTop, bandBottom, mapLabel, modifier)
    } else {
        KeylessLiveMap(sharer, bandTop, bandBottom, modifier)
    }
}

@Composable
private fun KeylessLiveMap(sharer: MapPerson, bandTop: Dp, bandBottom: Dp, modifier: Modifier) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val centerY = (bandTop + (maxHeight - bandBottom)) / 2
        CityMap(Modifier.fillMaxSize(), focusAt = Offset(0.5f, (centerY / maxHeight).coerceIn(0f, 1f)))
        val half = haloSize(sharer.person) / 2
        PersonMarker(
            person = sharer.person,
            label = sharer.label,
            contentDescription = sharer.description,
            state = sharer.state,
            pingKey = sharer.pingKey,
            modifier = Modifier.offset(maxWidth / 2 - half, centerY - half),
        )
    }
}

@Composable
private fun GoogleLiveMap(sharer: MapPerson, bandTop: Dp, bandBottom: Dp, mapLabel: String, modifier: Modifier) {
    val c = TmlTheme.colors
    val camera = rememberCameraPositionState()
    val at = if (sharer.lat != null && sharer.lng != null) LatLng(sharer.lat, sharer.lng) else null
    val approximate = sharer.state == MarkerState.Approximate
    LaunchedEffect(at, approximate) {
        at ?: return@LaunchedEffect
        camera.animate(CameraUpdateFactory.newLatLngZoom(at, if (approximate) ZOOM_APPROXIMATE else ZOOM_PRECISE))
    }
    Box(modifier.fillMaxSize()) {
        GoogleMap(
            modifier = Modifier.fillMaxSize().semantics { contentDescription = mapLabel },
            cameraPositionState = camera,
            contentPadding = PaddingValues(top = bandTop, bottom = bandBottom),
            uiSettings = MapUiSettings(
                compassEnabled = false,
                indoorLevelPickerEnabled = false,
                mapToolbarEnabled = false,
                myLocationButtonEnabled = false,
                zoomControlsEnabled = false,
            ),
        ) {
            if (at != null && approximate) {
                // The rounded point's soft circle, 1 km across (FSD §4 Location detail), with no trail.
                Circle(
                    center = at,
                    radius = APPROXIMATE_RADIUS_M,
                    fillColor = c.lamplightHalo,
                    strokeColor = c.lamplight.copy(alpha = 0.45f),
                    strokeWidth = with(LocalDensity.current) { 1.5.dp.toPx() },
                )
            }
        }
        val projection = camera.projection
        if (at != null && projection != null) {
            val p = projection.toScreenLocation(at)
            val half = with(LocalDensity.current) { (haloSize(sharer.person) / 2).roundToPx() }
            PersonMarker(
                person = sharer.person,
                label = sharer.label,
                contentDescription = sharer.description,
                // Google draws the approximate circle to scale; the marker keeps its halo-free look.
                state = if (approximate) MarkerState.Approximate else sharer.state,
                approximateRadius = 0.dp,
                pingKey = sharer.pingKey,
                modifier = Modifier.offset { IntOffset(p.x - half, p.y - half) },
            )
        }
    }
}

/**
 * Whether [LiveMap] draws Google Maps. Null, the default, decides from the build's Maps key. Tests
 * provide false, so they draw the keyless map whatever local.properties holds (Robolectric can't run
 * Google's map view).
 */
val LocalUseGoogleMap = staticCompositionLocalOf<Boolean?> { null }

/** The Maps key this build was made with, or null when it has none (local.properties MAPS_API_KEY). */
fun Context.mapsApiKey(): String? = try {
    packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
        .metaData?.getString(MAPS_KEY_NAME)?.takeIf { it.isNotBlank() }
} catch (_: PackageManager.NameNotFoundException) {
    null
}

private const val MAPS_KEY_NAME = "com.google.android.geo.API_KEY"
private const val ZOOM_PRECISE = 16f
private const val ZOOM_APPROXIMATE = 13.5f
private const val APPROXIMATE_RADIUS_M = 500.0
