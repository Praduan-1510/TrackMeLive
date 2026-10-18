package live.trackme.app.ui.mascot

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import live.trackme.app.ui.MinTouch
import live.trackme.app.ui.assertNoTextIsCut
import live.trackme.app.ui.setTmlContent
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp-xxhdpi")
class MascotPickerScreenTest {
    @get:Rule
    val rule = createComposeRule()

    private val radio = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton)
    private var saved: Triple<MascotId, MascotColor, MascotAccessory?>? = null

    private fun show(
        initial: MascotLook = MascotLook(),
        mode: MascotPickerMode = MascotPickerMode.Tab,
        saving: Boolean = false,
        error: String? = null,
        fontScale: Float = 1f,
        dark: Boolean = false,
    ) = rule.setTmlContent(fontScale = fontScale, dark = dark) {
        MascotPickerScreen(
            initial = initial,
            mode = mode,
            onSave = { id, color, accessory -> saved = Triple(id, color, accessory) },
            saving = saving,
            errorMessage = error,
        )
    }

    private fun tap(text: String) = rule.onNode(radio and hasText(text)).performScrollTo().performClick()

    @Test
    fun tabModeSavesAndSetupModeContinues() {
        show(mode = MascotPickerMode.Tab)
        rule.onNode(hasClickAction() and hasText("Save")).assertIsDisplayed().performClick()
        assertEquals(Triple(MascotId.FOX, MascotColor.ORIGINAL, null), saved)
    }

    @Test
    fun setupModeSaysContinue() {
        show(mode = MascotPickerMode.Setup)
        rule.onNode(hasClickAction() and hasText("Continue")).assertIsDisplayed()
    }

    @Test
    fun theChosenTileIsSelectedAndOnlyItsSetShows() {
        show(initial = MascotLook(MascotId.NINJA))
        rule.onNode(radio and hasText("Ninja")).assertIsSelected()
        rule.onNode(radio and hasText("Anime")).assertIsSelected()
        rule.onAllNodesWithText("Fox").assertCountEquals(0)
        tap("Classics")
        rule.onNode(radio and hasText("Fox")).assertIsNotSelected()
        rule.onNode(radio and hasText("Ninja", substring = false)).assertDoesNotExist()
    }

    @Test
    fun walkThroughCharactersColorsAndAccessories() {
        show()
        tap("Headphones")
        tap("Astronaut")
        rule.onNodeWithText("The astronaut’s helmet doesn’t take accessories.").performScrollTo().assertIsDisplayed()
        rule.onNode(radio and hasText("None")).assertDoesNotExist()

        tap("Robot")
        rule.onAllNodes(radio and (hasText("None") or hasText("Headlamp")))
            .assertCountEquals(2)
        tap("Anime")
        tap("Hero")
        tap("Glasses")
        rule.onNode(radio and hasContentDescription("Dusk")).performScrollTo().performClick().assertIsSelected()
        rule.onNode(hasClickAction() and hasText("Save")).performClick()
        assertEquals(Triple(MascotId.HERO, MascotColor.DUSK, MascotAccessory.GLASSES), saved)
    }

    @Test
    fun swatchesAndTilesAreAtLeast48dp() {
        show()
        val px = with(rule.density) { MinTouch.toPx() }
        listOf("Original", "Moss", "Lagoon", "Dusk", "Rose").forEach { name ->
            val node = rule.onNode(radio and hasContentDescription(name)).fetchSemanticsNode()
            assertTrue("$name swatch", node.touchBoundsInRoot.width >= px && node.touchBoundsInRoot.height >= px)
        }
        val tile = rule.onNode(radio and hasText("Fox")).fetchSemanticsNode()
        assertTrue(tile.touchBoundsInRoot.height >= px)
    }

    @Test
    fun savingDisablesTheButtonAndAnErrorShowsAboveIt() {
        show(saving = true, error = "We couldn't save your mascot. Check your connection, then try again.")
        rule.onNode(hasClickAction() and hasText("Save")).assertIsNotEnabled()
        rule.onNodeWithText("We couldn't save your mascot. Check your connection, then try again.").assertIsDisplayed()
    }

    @Test
    fun nothingIsCutShortAt200PercentInLight() {
        show(fontScale = 2f)
        rule.assertNoTextIsCut()
    }

    @Test
    fun nothingIsCutShortAt200PercentInDark() {
        show(fontScale = 2f, dark = true, initial = MascotLook(MascotId.DETECTIVE))
        rule.assertNoTextIsCut()
    }
}
