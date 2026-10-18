package live.trackme.app.ui.mascot

import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotCatalog
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.MascotSet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class MascotLookTest {
    @Test
    fun defaultLookIsTheOriginalFoxWithNoAccessory() {
        assertEquals(MascotLook(MascotId.FOX, MascotColor.ORIGINAL, null), MascotLook())
    }

    @Test
    fun anAccessoryTheCharacterCantWearIsDropped() {
        assertNull(MascotLook(MascotId.ASTRONAUT, accessory = MascotAccessory.HEADLAMP).normalized().accessory)
        assertNull(MascotLook(MascotId.FOX).withMascot(MascotId.HERO).withAccessory(MascotAccessory.HEADPHONES).accessory)
    }

    @Test
    fun pickingACharacterKeepsTheColorAndAFittingAccessory() {
        val robot = MascotLook(MascotId.ROBOT, MascotColor.DUSK, MascotAccessory.HEADLAMP)
        val ghost = robot.withMascot(MascotId.GHOST)
        assertEquals(MascotColor.DUSK, ghost.color)
        assertEquals(MascotAccessory.HEADLAMP, ghost.accessory)
        assertNull(ghost.withMascot(MascotId.HERO).accessory)
    }

    @Test
    fun setsHoldFourCharactersEachInThePrototypeOrder() {
        assertEquals(listOf(MascotId.FOX, MascotId.GHOST, MascotId.ROBOT, MascotId.ASTRONAUT), mascotsIn(MascotSet.CLASSICS))
        assertEquals(listOf(MascotId.HERO, MascotId.STAR, MascotId.NINJA, MascotId.NEKO), mascotsIn(MascotSet.ANIME))
        assertEquals(listOf(MascotId.ACE, MascotId.DETECTIVE, MascotId.COWBOY, MascotId.AGENT), mascotsIn(MascotSet.MOVIE))
        MascotId.entries.forEach { assertEquals(it, mascotsIn(mascotSetOf(it)).single { id -> id == it }) }
    }

    @Test
    fun everyCharacterHasARenderPerColorAndAFlatHead() {
        MascotId.entries.forEach { id ->
            val renders = MascotColor.entries.map { MascotArtTable.render(id, it) }
            assertEquals("five distinct renders for $id", MascotColor.entries.size, renders.toSet().size)
            assertNotEquals(0, MascotArtTable.flat(id))
        }
    }

    @Test
    fun accessoryLayersMatchTheSharedAccessoryTable() {
        MascotId.entries.forEach { id ->
            MascotAccessory.entries.forEach { accessory ->
                val takes = accessory in MascotCatalog.accessoriesFor(id)
                val layer = MascotArtTable.accessory(id, accessory)
                if (takes) assertNotNull("$id takes $accessory", layer) else assertNull("$id doesn't take $accessory", layer)
            }
        }
        assertEquals(emptyList<MascotAccessory>(), MascotLook(MascotId.ASTRONAUT).accessories)
    }

    @Test
    fun aColorRenderFallsBackToTheOriginalRender() {
        assertEquals(
            listOf(MascotArtTable.render(MascotId.STAR, MascotColor.ROSE), MascotArtTable.render(MascotId.STAR, MascotColor.ORIGINAL)),
            renderCandidates(MascotId.STAR, MascotColor.ROSE),
        )
        assertEquals(
            listOf(MascotArtTable.render(MascotId.STAR, MascotColor.ORIGINAL)),
            renderCandidates(MascotId.STAR, MascotColor.ORIGINAL),
        )
    }
}
