package live.trackme.app.ui.map

import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.toArgb
import live.trackme.app.BuildConfig
import live.trackme.design.TmlColors
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.PropertyFactory.backgroundColor
import org.maplibre.android.style.layers.PropertyFactory.fillColor
import org.maplibre.android.style.layers.PropertyFactory.fillOutlineColor
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.textColor
import org.maplibre.android.style.layers.PropertyFactory.textHaloColor
import org.maplibre.android.style.layers.PropertyValue
import org.maplibre.android.style.layers.SymbolLayer

/** The live map's styles: OpenFreeMap's Positron for light and Dark for dark, from the one setting (app/build.gradle.kts tml.mapStyles). */
object MapStyles {
    fun url(dark: Boolean): String = "${BuildConfig.MAP_STYLES}/${if (dark) DARK else LIGHT}"

    /** Quiet and nearly colorless, so our marker and our map tokens lead (tiles.openfreemap.org/styles/positron). */
    const val LIGHT = "positron"

    /** The same layout in dark (tiles.openfreemap.org/styles/dark). */
    const val DARK = "dark"
}

/**
 * Repaints a loaded Positron or Dark style in our map tokens (design-system map-land, map-road,
 * map-road-major, map-park, map-water, map-label), so the tile map matches the keyless map, the
 * onboarding art and the viewer, and keeps the contrast the tokens were chosen for: markers 3:1 and
 * labels 4.5:1 against every map color (FSD §7 Accessibility). Layers it doesn't find are left as the style draws
 * them, so a change on OpenFreeMap's side costs looks, never the map.
 */
object MapPaint {
    fun paint(style: Style, c: TmlColors) {
        val land = c.mapLand.toArgb()
        val road = c.mapRoad.toArgb()
        val major = c.mapRoadMajor.toArgb()
        // Edges and buildings: a step from the land toward the labels, in either theme.
        val casing = lerp(c.mapLand, c.mapLabel, CASING_MIX).toArgb()
        val building = lerp(c.mapLand, c.mapRoad, BUILDING_MIX).toArgb()
        val buildingEdge = lerp(c.mapLand, c.mapLabel, BUILDING_EDGE_MIX).toArgb()

        fun set(ids: List<String>, vararg values: PropertyValue<*>) = ids.forEach { style.getLayer(it)?.setProperties(*values) }

        set(listOf("background"), backgroundColor(land))
        set(listOf("landuse_residential", "road_area_pier", "landcover_ice_shelf", "landcover_glacier"), fillColor(land))
        set(listOf("road_pier"), lineColor(land))
        set(listOf("water"), fillColor(c.mapWater.toArgb()))
        set(listOf("waterway"), lineColor(c.mapWater.toArgb()))
        set(listOf("park", "landuse_park", "landcover_wood"), fillColor(c.mapPark.toArgb()))
        set(listOf("building"), fillColor(building), fillOutlineColor(buildingEdge))
        set(listOf("highway_path", "highway_minor"), lineColor(road))
        set(
            listOf(
                "highway_major_inner", "highway_major_subtle", "highway_motorway_inner", "highway_motorway_subtle",
                "highway_motorway_bridge_inner", "tunnel_motorway_inner",
            ),
            lineColor(major),
        )
        set(
            listOf("highway_major_casing", "highway_motorway_casing", "highway_motorway_bridge_casing", "tunnel_motorway_casing"),
            lineColor(casing),
        )
        // Every label in map-label on a land halo; road shields keep their own colors, drawn on their badge.
        val label = c.mapLabel.toArgb()
        style.layers.filterIsInstance<SymbolLayer>()
            .filterNot { SHIELD in it.id }
            .forEach { it.setProperties(textColor(label), textHaloColor(land)) }
    }

    private const val SHIELD = "shield"
    private const val CASING_MIX = 0.22f
    private const val BUILDING_MIX = 0.5f
    private const val BUILDING_EDGE_MIX = 0.12f
}
