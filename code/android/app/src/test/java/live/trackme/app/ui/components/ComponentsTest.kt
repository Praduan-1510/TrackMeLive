package live.trackme.app.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.test.ext.junit.runners.AndroidJUnit4
import live.trackme.app.ui.MinTouch
import live.trackme.app.ui.assertNoTextIsCut
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.setTmlContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ComponentsTest {
    @get:Rule
    val rule = createComposeRule()

    private fun role(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

    @Test
    fun buttonClicksAndKeepsA48dpTarget() {
        var clicks = 0
        rule.setTmlContent {
            Column {
                TmlButton(text = "Not now", onClick = { clicks++ }, variant = ButtonVariant.Plain)
                PrimaryButton(text = "Share live location", onClick = { clicks++ })
            }
        }
        rule.onNodeWithText("Not now").performClick()
        assertEquals(1, clicks)
        val plain = rule.onNode(hasClickAction() and hasText("Not now")).fetchSemanticsNode()
        assertTrue("touch target ${plain.touchBoundsInRoot}", plain.touchBoundsInRoot.height >= with(rule.density) { MinTouch.toPx() })
        val primary = rule.onNode(hasClickAction() and hasText("Share live location")).getBoundsInRoot()
        assertTrue("main action is 56dp", primary.height >= TmlButtonDefaults.LargeHeight)
    }

    @Test
    fun disabledAndLoadingButtonsIgnoreTaps() {
        var clicks = 0
        rule.setTmlContent {
            Column {
                TmlButton(text = "Disabled", onClick = { clicks++ }, enabled = false)
                PrimaryButton(text = "Save", onClick = { clicks++ }, loading = true)
            }
        }
        rule.onNode(hasClickAction() and hasText("Disabled")).assertIsNotEnabled()
        rule.onNode(hasClickAction() and hasText("Save")).assertIsNotEnabled().performClick()
        assertEquals(0, clicks)
    }

    @Test
    fun segmentedControlSelectsAndStacksWhenLabelsDontFit() {
        var selected by mutableStateOf(0)
        rule.setTmlContent(fontScale = 2f) {
            SegmentedControl(
                labels = listOf("System", "Light", "Dark"),
                selectedIndex = selected,
                onSelect = { selected = it },
                modifier = Modifier.width(280.dp),
            )
        }
        rule.onNodeWithText("Dark").performClick()
        assertEquals(2, selected)
        rule.onNode(role(Role.RadioButton) and hasText("Dark")).assertIsSelected()
        val system = rule.onNodeWithText("System").getBoundsInRoot()
        val light = rule.onNodeWithText("Light").getBoundsInRoot()
        assertTrue("stacked: Light is under System", light.top >= system.bottom)
        rule.assertNoTextIsCut()
    }

    @Test
    fun segmentedControlStaysOneRowWhenLabelsFit() {
        rule.setTmlContent {
            SegmentedControl(labels = listOf("Precise", "Approximate"), selectedIndex = 0, onSelect = {}, modifier = Modifier.width(360.dp))
        }
        val precise = rule.onNodeWithText("Precise").getBoundsInRoot()
        val approximate = rule.onNodeWithText("Approximate").getBoundsInRoot()
        assertEquals(precise.top, approximate.top)
    }

    @Test
    fun switchRowReadsAsOneSwitch() {
        var on by mutableStateOf(false)
        rule.setTmlContent {
            SwitchRow(headline = "When sharing expires", supporting = "Alerting", checked = on, onCheckedChange = { on = it })
        }
        val row = rule.onNode(role(Role.Switch))
        row.assertIsOff().assert(hasText("When sharing expires")).assert(hasText("Alerting"))
        row.performClick()
        row.assertIsOn()
        assertTrue(on)
    }

    @Test
    fun choiceChipsAreRadioButtons() {
        var selected by mutableStateOf(0)
        rule.setTmlContent {
            ChoiceChipGroup(labels = listOf("None", "Glasses"), selectedIndex = selected, onSelect = { selected = it })
        }
        rule.onNode(role(Role.RadioButton) and hasText("Glasses")).performClick().assertIsSelected()
        assertEquals(1, selected)
        val chip = rule.onNode(role(Role.RadioButton) and hasText("None")).fetchSemanticsNode()
        assertTrue(chip.touchBoundsInRoot.height >= with(rule.density) { MinTouch.toPx() })
    }

    @Test
    fun statusPillAlwaysCarriesItsWord() {
        rule.setTmlContent { StatusPill("Last seen 9:41 pm", kind = PillKind.Neutral) }
        rule.onNodeWithText("Last seen 9:41 pm").assertIsDisplayed()
    }

    @Test
    fun personRowAndMarkerReadAsOnePhrase() {
        rule.setTmlContent {
            Column {
                PersonRow(
                    person = Person.Viewer("M"),
                    name = "Mom",
                    detail = "Sharing back · updated 3 s ago",
                    status = "Live",
                    statusTone = StatusTone.Viewer,
                    spokenDescription = "Mom, live, sharing back, updated 3 seconds ago",
                )
                PersonMarker(
                    person = Person.Sharer(MascotLook()),
                    label = "You",
                    contentDescription = "You, live, updated 2 seconds ago",
                )
            }
        }
        rule.onNodeWithContentDescription("Mom, live, sharing back, updated 3 seconds ago").assertIsDisplayed()
        rule.onNodeWithContentDescription("You, live, updated 2 seconds ago").assertIsDisplayed()
    }

    @Test
    fun statTilesStackAtLargeTextAndNeverCutAValue() {
        rule.setTmlContent(fontScale = 2f) {
            StatTileRow(Modifier.width(360.dp)) {
                StatTile("1.2 km", "apart")
                StatTile("04:12", "on the call")
                StatTile("Waiting", "for Mom to share")
            }
        }
        val first = rule.onNodeWithText("1.2 km").getBoundsInRoot()
        val second = rule.onNodeWithText("04:12").getBoundsInRoot()
        assertTrue("stacked", second.top > first.bottom)
        rule.assertNoTextIsCut()
    }

    @Test
    fun statTilesSitSideBySideAtDefaultSizeAndLabelsWrap() {
        rule.setTmlContent {
            StatTileRow(Modifier.width(347.dp)) {
                StatTile("1.2 km", "apart")
                StatTile("04:12", "on the call")
                StatTile("Waiting", "for Mom to share")
            }
        }
        val first = rule.onNodeWithText("1.2 km").getBoundsInRoot()
        val third = rule.onNodeWithText("Waiting").getBoundsInRoot()
        assertEquals("one row", first.top, third.top)
        rule.assertNoTextIsCut()
    }

    @Test
    fun personRowWrapsAtLargeText() {
        rule.setTmlContent(fontScale = 2f) {
            PersonRow(
                person = Person.Sharer(MascotLook()),
                name = "You",
                detail = "Sharing · updated 3 s ago",
                status = "Live",
                statusTone = StatusTone.Sharer,
                modifier = Modifier.width(360.dp),
            )
        }
        rule.assertNoTextIsCut()
    }

    @Test
    fun mapSheetPinsItsActionsWhenItsContentScrolls() {
        rule.setTmlContent(fontScale = 2f) {
            Box(Modifier.height(360.dp)) {
                MapSheet(
                    title = "You’re both live",
                    subtitle = "Visible until your call ends.",
                    actions = {
                        SheetActions {
                            TmlButton("Change timer", onClick = {}, variant = ButtonVariant.Tonal)
                            TmlButton("Stop sharing", onClick = {}, variant = ButtonVariant.Danger)
                        }
                    },
                ) {
                    StatTileRow {
                        StatTile("1.2 km", "apart")
                        StatTile("04:12", "on the call")
                    }
                    PersonRow(person = Person.Viewer("M"), name = "Mom", detail = "Sharing back · updated 2 s ago")
                }
            }
        }
        rule.onNode(hasClickAction() and hasText("Stop sharing")).assertIsDisplayed()
        rule.onNodeWithText("You’re both live").assertIsDisplayed()
        val change = rule.onNodeWithText("Change timer").getBoundsInRoot()
        val stop = rule.onNodeWithText("Stop sharing").getBoundsInRoot()
        assertTrue("actions stack at 200%", stop.top > change.top)
    }

    @Test
    fun mapSheetInAScrollingParentShowsAllItsContent() {
        rule.setTmlContent {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                MapSheet(title = "You’re both live") { StatTile("1.2 km", "apart") }
            }
        }
        rule.onNodeWithText("You’re both live").assertIsDisplayed()
        rule.onNodeWithText("1.2 km").assertIsDisplayed()
    }

    @Test
    fun standaloneSwitchToggles() {
        rule.setTmlContent {
            var on by remember { mutableStateOf(true) }
            TmlSwitch(checked = on, onCheckedChange = { on = it })
        }
        rule.onNode(role(Role.Switch)).assertIsOn().performClick().assertIsOff()
    }
}
