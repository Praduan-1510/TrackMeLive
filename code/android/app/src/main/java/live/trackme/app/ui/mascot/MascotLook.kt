package live.trackme.app.ui.mascot

import androidx.annotation.ColorRes
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Immutable
import live.trackme.app.R
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotCatalog
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.MascotSet

/**
 * What someone's mascot looks like: the character, its color and an optional accessory (FSD §11).
 * An accessory the character can't wear is dropped, so a look is always one the renders can draw.
 */
@Immutable
data class MascotLook(
    val id: MascotId = MascotCatalog.DEFAULT_MASCOT,
    val color: MascotColor = MascotCatalog.DEFAULT_COLOR,
    val accessory: MascotAccessory? = null,
) {
    /** This look with an accessory the character can't wear removed. */
    fun normalized(): MascotLook = if (MascotCatalog.takes(id, accessory)) this else copy(accessory = null)

    /** Another character, keeping the color and the accessory when it fits (the prototype's pickMascot). */
    fun withMascot(newId: MascotId): MascotLook = copy(id = newId).normalized()

    /** Another accessory, or none; one the character can't wear means none. */
    fun withAccessory(newAccessory: MascotAccessory?): MascotLook = copy(accessory = newAccessory).normalized()

    /** The accessories this character takes, in catalog order (empty for the astronaut). */
    val accessories: List<MascotAccessory> get() = MascotCatalog.accessoriesFor(id)

    /** The set this character belongs to. */
    val set: MascotSet get() = mascotSetOf(id)
}

/** The set [id] belongs to. */
fun mascotSetOf(id: MascotId): MascotSet = MascotCatalog.all.first { it.id == id }.set

/** The characters of [set], in catalog order. */
fun mascotsIn(set: MascotSet): List<MascotId> = MascotCatalog.all.filter { it.set == set }.map { it.id }

/** The character's display name ("Fox"). Names live in strings, never in the schema. */
@StringRes
fun mascotNameRes(id: MascotId): Int = when (id) {
    MascotId.FOX -> R.string.mascot_name_fox
    MascotId.GHOST -> R.string.mascot_name_ghost
    MascotId.ROBOT -> R.string.mascot_name_robot
    MascotId.ASTRONAUT -> R.string.mascot_name_astronaut
    MascotId.HERO -> R.string.mascot_name_hero
    MascotId.STAR -> R.string.mascot_name_star
    MascotId.NINJA -> R.string.mascot_name_ninja
    MascotId.NEKO -> R.string.mascot_name_neko
    MascotId.ACE -> R.string.mascot_name_ace
    MascotId.DETECTIVE -> R.string.mascot_name_detective
    MascotId.COWBOY -> R.string.mascot_name_cowboy
    MascotId.AGENT -> R.string.mascot_name_agent
}

/** The set's display name: Classics, Anime, Movie night. */
@StringRes
fun mascotSetNameRes(set: MascotSet): Int = when (set) {
    MascotSet.CLASSICS -> R.string.mascot_set_classics_name
    MascotSet.ANIME -> R.string.mascot_set_anime
    MascotSet.MOVIE -> R.string.mascot_set_movie
}

/** The color's display name: Original, Moss, Lagoon, Dusk, Rose. */
@StringRes
fun mascotColorNameRes(color: MascotColor): Int = when (color) {
    MascotColor.ORIGINAL -> R.string.mascot_color_original
    MascotColor.MOSS -> R.string.mascot_color_moss
    MascotColor.LAGOON -> R.string.mascot_color_lagoon
    MascotColor.DUSK -> R.string.mascot_color_dusk
    MascotColor.ROSE -> R.string.mascot_color_rose
}

/** The accessory's display name; null means None. */
@StringRes
fun mascotAccessoryNameRes(accessory: MascotAccessory?): Int = when (accessory) {
    null -> R.string.mascot_accessory_none
    MascotAccessory.HEADPHONES -> R.string.mascot_accessory_headphones
    MascotAccessory.GLASSES -> R.string.mascot_accessory_glasses
    MascotAccessory.HEADLAMP -> R.string.mascot_accessory_headlamp
}

/**
 * The swatch for [color] on [id]: Original shows the character's own key color, measured from its
 * renders; the others show the color itself (prototype `swatchFor`).
 */
@ColorRes
fun mascotSwatchRes(id: MascotId, color: MascotColor): Int = when (color) {
    MascotColor.ORIGINAL -> when (id) {
        MascotId.FOX -> R.color.mascot_key_fox
        MascotId.GHOST -> R.color.mascot_key_ghost
        MascotId.ROBOT -> R.color.mascot_key_robot
        MascotId.ASTRONAUT -> R.color.mascot_key_astronaut
        MascotId.HERO -> R.color.mascot_key_hero
        MascotId.STAR -> R.color.mascot_key_star
        MascotId.NINJA -> R.color.mascot_key_ninja
        MascotId.NEKO -> R.color.mascot_key_neko
        MascotId.ACE -> R.color.mascot_key_ace
        MascotId.DETECTIVE -> R.color.mascot_key_detective
        MascotId.COWBOY -> R.color.mascot_key_cowboy
        MascotId.AGENT -> R.color.mascot_key_agent
    }
    MascotColor.MOSS -> R.color.mascot_swatch_moss
    MascotColor.LAGOON -> R.color.mascot_swatch_lagoon
    MascotColor.DUSK -> R.color.mascot_swatch_dusk
    MascotColor.ROSE -> R.color.mascot_swatch_rose
}

/** The 512 px render of [id] in [color], for callers that need the resource itself. */
@DrawableRes
fun mascotRenderRes(id: MascotId, color: MascotColor = MascotColor.ORIGINAL): Int = MascotArtTable.render(id, color)
