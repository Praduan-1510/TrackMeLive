package live.trackme.app.ui.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import live.trackme.app.data.settings.Appearance
import live.trackme.app.ui.assertNoTextIsCut
import live.trackme.app.ui.setTmlContent
import live.trackme.schema.DefaultStop
import live.trackme.schema.Precision
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
class SettingsScreenTest {
    @get:Rule
    val rule = createComposeRule()

    private val events = mutableListOf<SettingsEvent>()
    private var state by mutableStateOf(SettingsUiState())

    private fun matches(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

    /** Shows Settings with a tiny stand-in for the ViewModel: it records each event and applies it. */
    private fun show(initial: SettingsUiState = SettingsUiState(), fontScale: Float = 1f, dark: Boolean = false) {
        state = initial
        rule.setTmlContent(fontScale = fontScale, dark = dark) {
            SettingsScreen(state = state, onEvent = { event ->
                events += event
                state = when (event) {
                    is SettingsEvent.OfferOnCallChanged -> state.copy(offerOnCall = event.on)
                    is SettingsEvent.PrecisionChanged -> state.copy(precision = event.precision)
                    is SettingsEvent.DefaultStopChanged -> state.copy(defaultStop = event.stop)
                    is SettingsEvent.ShareBackChanged -> state.copy(shareBack = event.on)
                    is SettingsEvent.AlertLinkOpenedChanged -> state.copy(alertLinkOpened = event.on)
                    is SettingsEvent.AlertCallEndedChanged -> state.copy(alertCallEnded = event.on)
                    is SettingsEvent.AlertExpiryChanged -> state.copy(alertExpiry = event.on)
                    is SettingsEvent.AppearanceChanged -> state.copy(appearance = event.appearance)
                    SettingsEvent.DeleteAccountConfirmed -> state
                }
            })
        }
    }

    @Test
    fun switchesReadAsSwitchesAndReportChanges() {
        show()
        val offer = rule.onNode(matches(Role.Switch) and hasText("Offer to share when I’m on a call"))
        offer.assertIsOn().performClick().assertIsOff()
        rule.onNode(matches(Role.Switch) and hasText("When sharing expires")).performScrollTo().performClick().assertIsOff()
        assertEquals(listOf(SettingsEvent.OfferOnCallChanged(false), SettingsEvent.AlertExpiryChanged(false)), events)
    }

    @Test
    fun precisionAndAppearanceAreSegmentedChoices() {
        show()
        rule.onNode(matches(Role.RadioButton) and hasText("Approximate")).performClick().assertIsSelected()
        rule.onNode(matches(Role.RadioButton) and hasText("Dark")).performScrollTo().performClick().assertIsSelected()
        assertEquals(
            listOf(SettingsEvent.PrecisionChanged(Precision.APPROXIMATE), SettingsEvent.AppearanceChanged(Appearance.Dark)),
            events,
        )
    }

    @Test
    fun defaultStopOpensASheetOfChoices() {
        show()
        rule.onNode(hasClickAction() and hasText("Default stop time")).performClick()
        rule.onNode(matches(Role.RadioButton) and hasText("When the call ends")).assertIsSelected()
        rule.onNodeWithText("Sharing never runs longer than 1 hour.").assertIsDisplayed()
        rule.onNode(matches(Role.RadioButton) and hasText("In 30 min")).performClick()
        rule.waitForIdle()
        assertEquals(listOf(SettingsEvent.DefaultStopChanged(DefaultStop.MINUTES_30)), events)
        rule.onNode(matches(Role.RadioButton) and hasText("In 30 min")).assertDoesNotExist()
        rule.onNode(hasClickAction() and hasText("In 30 min")).assertIsDisplayed()
    }

    @Test
    fun deleteAccountAsksFirstAndCancelDoesNothing() {
        show()
        val row = rule.onNode(hasClickAction() and hasText("Delete account and all data"))
        row.performScrollTo().performClick()
        rule.onNode(isDialog()).assertIsDisplayed()
        rule.onNodeWithText("Delete your account?").assertIsDisplayed()
        rule.onNode(hasClickAction() and hasText("Cancel")).performClick()
        rule.onNode(isDialog()).assertDoesNotExist()
        assertTrue(events.isEmpty())

        row.performClick()
        rule.onNode(hasClickAction() and hasText("Delete")).performClick()
        rule.onNode(isDialog()).assertDoesNotExist()
        assertEquals(listOf<SettingsEvent>(SettingsEvent.DeleteAccountConfirmed), events)
    }

    @Test
    fun permissionsSayWhereTheyStandInWords() {
        show(
            SettingsUiState(
                permissions = PermissionsUiState(
                    location = PermissionStatus.Allowed,
                    preciseLocation = false,
                    phone = PermissionStatus.Denied,
                    notifications = PermissionStatus.NotAsked,
                ),
            ),
        )
        rule.onNodeWithText("While using the app · approximate").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Not allowed · so sharing can stop when your call ends").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Not set").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("If picture-in-picture is off, sharing still works and the ongoing notification shows it.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun permissionRowsAreDisplayOnlyForNow() {
        show()
        rule.onNode(hasClickAction() and hasText("Location")).assertDoesNotExist()
    }

    @Test
    fun deleteShowsItsProgressAndCantBeTappedAgain() {
        show(SettingsUiState(deleting = true))
        val row = rule.onNode(hasText("Delete account and all data", substring = true) and hasText("Deleting your account…", substring = true))
        row.performScrollTo().assertIsDisplayed()
        row.assert(SemanticsMatcher.keyNotDefined(SemanticsActions.OnClick))
        row.assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Disabled))
    }

    @Test
    fun aQuietNoteSaysWhenTheProfileCantUpdate() {
        show()
        rule.onAllNodes(hasText("Can’t update your profile right now.")).assertCountEquals(0)
        state = state.copy(updatesUnavailable = true)
        rule.onNode(
            hasText("Can’t update your profile right now.") and
                SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
        ).assertIsDisplayed()
        state = state.copy(updatesUnavailable = false)
        rule.onAllNodes(hasText("Can’t update your profile right now.")).assertCountEquals(0)
    }

    @Test
    fun nothingIsCutShortAt200PercentInLight() {
        show(fontScale = 2f)
        rule.assertNoTextIsCut()
    }

    @Test
    fun nothingIsCutShortAt200PercentInDark() {
        show(fontScale = 2f, dark = true)
        rule.assertNoTextIsCut()
    }
}
