package live.trackme.app.ui.mascot

import androidx.compose.runtime.saveable.SaverScope
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.MascotSet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The picker's rules, as the prototype's walk-android.mjs checks them. */
class MascotPickerStateTest {
    @Test
    fun startsOnTheSetOfTheChosenCharacter() {
        assertEquals(MascotSet.MOVIE, MascotPickerState(MascotLook(MascotId.AGENT)).shownSet)
    }

    @Test
    fun followsThePrototypeWalk() {
        val state = MascotPickerState(MascotLook())
        state.pickAccessory(MascotAccessory.HEADPHONES)
        state.pickMascot(MascotId.ASTRONAUT)
        assertNull("astronaut resets the accessory", state.look.accessory)

        state.pickMascot(MascotId.ROBOT)
        state.pickAccessory(MascotAccessory.HEADLAMP)
        state.pickMascot(MascotId.GHOST)
        assertEquals("ghost keeps the headlamp", MascotAccessory.HEADLAMP, state.look.accessory)

        state.showSet(MascotSet.ANIME)
        assertEquals("switching sets keeps the choice", MascotId.GHOST, state.look.id)
        state.pickMascot(MascotId.HERO)
        assertNull("hero drops the headlamp", state.look.accessory)

        state.pickAccessory(MascotAccessory.GLASSES)
        state.pickColor(MascotColor.DUSK)
        assertEquals(MascotLook(MascotId.HERO, MascotColor.DUSK, MascotAccessory.GLASSES), state.look)
    }

    @Test
    fun anAccessoryTheCharacterCantWearMeansNone() {
        val state = MascotPickerState(MascotLook(MascotId.NINJA))
        state.pickAccessory(MascotAccessory.GLASSES)
        assertNull(state.look.accessory)
    }

    @Test
    fun anInvalidStartingLookIsNormalized() {
        assertNull(MascotPickerState(MascotLook(MascotId.ASTRONAUT, accessory = MascotAccessory.GLASSES)).look.accessory)
    }

    @Test
    fun savesAndRestoresTheDraftAndTheShownSet() {
        val state = MascotPickerState(MascotLook(MascotId.STAR, MascotColor.ROSE, MascotAccessory.HEADLAMP))
        state.showSet(MascotSet.CLASSICS)
        val saved = with(MascotPickerState.Saver) { SaverScope { true }.save(state) }!!
        val restored = MascotPickerState.Saver.restore(saved)!!
        assertEquals(state.look, restored.look)
        assertEquals(MascotSet.CLASSICS, restored.shownSet)
    }
}
