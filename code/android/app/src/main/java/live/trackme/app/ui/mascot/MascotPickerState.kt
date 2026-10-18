package live.trackme.app.ui.mascot

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.MascotSet

/**
 * The picker's draft: the look being built and the set on show. Nothing is saved until Save
 * (or Continue); the rules match the prototype's actions:
 * - picking a character keeps the color, and keeps the accessory only if the new character takes it;
 * - an accessory the character can't wear means none;
 * - switching sets only changes which characters show, never the choice.
 */
@Stable
class MascotPickerState(initial: MascotLook, shownSet: MascotSet = initial.set) {
    var look: MascotLook by mutableStateOf(initial.normalized())
        private set

    var shownSet: MascotSet by mutableStateOf(shownSet)
        private set

    fun showSet(set: MascotSet) {
        shownSet = set
    }

    fun pickMascot(id: MascotId) {
        look = look.withMascot(id)
    }

    fun pickColor(color: MascotColor) {
        look = look.copy(color = color)
    }

    fun pickAccessory(accessory: MascotAccessory?) {
        look = look.withAccessory(accessory)
    }

    companion object {
        /** Survives rotation and process death as wire ids. */
        val Saver: Saver<MascotPickerState, Any> = Saver(
            save = { listOf(it.look.id.wire, it.look.color.wire, it.look.accessory?.wire, it.shownSet.wire) },
            restore = { saved ->
                val values = saved as List<*>
                val look = MascotLook(
                    id = MascotId.fromWire(values[0] as String?) ?: MascotLook().id,
                    color = MascotColor.fromWire(values[1] as String?) ?: MascotLook().color,
                    accessory = MascotAccessory.fromWire(values[2] as String?),
                )
                MascotPickerState(look, MascotSet.fromWire(values[3] as String?) ?: look.set)
            },
        )
    }
}

/** A picker draft that starts from [initial] and starts over whenever [initial] changes (a new profile). */
@Composable
fun rememberMascotPickerState(initial: MascotLook): MascotPickerState =
    rememberSaveable(initial, saver = MascotPickerState.Saver) { MascotPickerState(initial) }
