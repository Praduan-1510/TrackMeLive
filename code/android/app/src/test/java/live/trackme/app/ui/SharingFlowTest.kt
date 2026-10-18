package live.trackme.app.ui

import android.app.Activity
import android.content.Intent
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.core.app.ActivityOptionsCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import live.trackme.app.TrackMeLiveApplication
import live.trackme.app.data.location.PermissionStatus
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.fakes.FakeAppContainer
import live.trackme.app.fakes.FakeLocationPermissions
import live.trackme.app.ui.navigation.AppViewModel
import live.trackme.app.ui.navigation.TrackMeLiveApp
import live.trackme.app.ui.share.ACTION_TARGET_CHOSEN
import live.trackme.schema.EndReason
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The share flow through the real app root on fakes: Home, the location gate, the share screen, the
 * share sheet, the live map, Stop and the ended screen. The system's dialogs and the share sheet are
 * answered by a test result registry, the way Android would answer them.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp-xxhdpi")
class SharingFlowTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val container = FakeAppContainer(scope).also {
        ApplicationProvider.getApplicationContext<TrackMeLiveApplication>().useContainer(it)
    }
    private val sharing get() = container.sharing
    private val permissions get() = container.locationPermissions

    /** What each launch is answered with; what was launched. */
    private var locationAnswer = mapOf(FakeLocationPermissions.FINE to true, FakeLocationPermissions.COARSE to true)
    private var notificationAnswer = true
    private var sheetSends = true
    private val launched = mutableListOf<Any?>()

    private val registry = object : ActivityResultRegistry() {
        override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
            launched += input
            when {
                input is Array<*> -> dispatchResult(requestCode, locationAnswer)
                input is String -> dispatchResult(requestCode, notificationAnswer)
                input is Intent && input.action == Intent.ACTION_CHOOSER -> {
                    // The person picks an app: Android reports it to the app before the sheet closes.
                    if (sheetSends) {
                        rule.activity.sendBroadcast(Intent(ACTION_TARGET_CHOSEN).setPackage(rule.activity.packageName))
                        shadowOf(Looper.getMainLooper()).idle()
                    }
                    dispatchResult(requestCode, androidx.activity.result.ActivityResult(Activity.RESULT_CANCELED, null))
                }
                else -> error("unexpected launch $input")
            }
        }
    }

    @After
    fun tearDown() = scope.cancel()

    private fun show() {
        container.preferences.setupStage.value = SetupStage.Done
        runBlocking { container.auth.verifyCode(container.auth.validCode) }
        container.profileSource.stored = Profile(name = "Alex", lastViewerName = "Mom")
        container.profileSource.deliver()
        val app = AppViewModel(container.preferences, container.auth, container.sharing)
        rule.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides object : ActivityResultRegistryOwner {
                override val activityResultRegistry = registry
            }) {
                TrackMeLiveApp(app)
            }
        }
        rule.onNodeWithText("Hi, Alex", substring = true).assertIsDisplayed()
    }

    private fun tapShareOnHome() = rule.onNode(hasText("Share live location") and hasClickAction()).performClick()

    @Test
    fun fromHomeToALiveLinkAndBackToHome() {
        show()
        tapShareOnHome()

        // First time: our explainer, then the system dialog (granted).
        rule.onNodeWithText("Allow location to share").assertIsDisplayed()
        rule.onNodeWithText("Continue").performClick()
        rule.waitUntil { rule.onAllNodes(hasText("Share where you are")).fetchSemanticsNodes().isNotEmpty() }
        assertEquals(PermissionStatus.Granted, permissions.state.value.location)

        // The last name used is filled in.
        rule.onNode(hasSetTextAction() and hasText("Mom")).assertIsDisplayed()
        rule.onNode(hasText("Share live location") and hasClickAction()).performClick()

        // The link went out: the live map, which asks for alerts once.
        rule.waitUntil { rule.onAllNodes(hasText("Know when Mom opens it")).fetchSemanticsNodes().isNotEmpty() }
        assertEquals("Mom", sharing.createRequests.single().viewerName)
        assertTrue(launched.any { it is Intent && it.action == Intent.ACTION_CHOOSER })
        assertEquals(0, sharing.discards)
        rule.onNodeWithText("Turn on alerts").performClick()
        rule.waitUntil { permissions.notificationResults.isNotEmpty() }
        assertEquals(listOf(true), permissions.notificationResults)

        rule.onNodeWithText("Link sent to Mom. You’ll know when it’s opened.").assertIsDisplayed()

        // Back is Home, where the live card leads back to the map.
        rule.activity.onBackPressedDispatcher.onBackPressed()
        rule.onNodeWithText("Sharing with Mom").assertIsDisplayed()
        rule.onNodeWithText("Tap to open the map.").performClick()
        rule.onNodeWithText("Link sent to Mom. You’ll know when it’s opened.").assertIsDisplayed()

        // Stop asks first, then the ended screen; Done is Home.
        rule.onNode(hasText("Stop sharing") and hasClickAction()).performClick()
        rule.onNodeWithText("Stop sharing your location?").assertIsDisplayed()
        rule.onNodeWithText("Stop").performClick()
        rule.waitUntil { rule.onAllNodes(hasText("Sharing ended")).fetchSemanticsNodes().isNotEmpty() }
        assertEquals(1, sharing.stops)
        rule.onNodeWithText("You stopped sharing at", substring = true).assertIsDisplayed()
        rule.onNode(hasText("Done") and hasClickAction()).performClick()
        rule.onNode(hasText("Share live location") and hasClickAction()).assertIsDisplayed()
        assertEquals(ShareState.Idle, sharing.state.value)
    }

    @Test
    fun aShareSheetClosedWithoutAChoiceTakesTheLinkBack() {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted
        sheetSends = false
        show()
        tapShareOnHome()
        rule.onNodeWithText("Share where you are").assertIsDisplayed()
        rule.onNode(hasSetTextAction()).performTextClearance()
        rule.onNode(hasText("Share live location") and hasClickAction()).performClick()
        rule.waitUntil { sharing.discards == 1 }
        assertEquals(ShareState.Idle, sharing.state.value)
        assertEquals(null, sharing.createRequests.single().viewerName)
        // Still on the share screen, ready to try again; Back is Home.
        rule.onNodeWithText("Share where you are").assertIsDisplayed()
        rule.onNode(hasContentDescription("Home")).performClick()
        rule.onNodeWithText("Not on a call").assertIsDisplayed()
    }

    @Test
    fun aRefusalOffersSettingsAndNotNowStaysHome() {
        locationAnswer = mapOf(FakeLocationPermissions.FINE to false, FakeLocationPermissions.COARSE to false)
        show()
        tapShareOnHome()
        rule.onNodeWithText("Continue").performClick()
        rule.onNodeWithText("Location is off for Track Me Live").assertIsDisplayed()
        rule.onNodeWithText("To share where you are, allow location in Settings. It’s only used while you share.").assertIsDisplayed()
        rule.onNodeWithText("Open settings").performClick()
        assertEquals("fake.APP_SETTINGS", shadowOf(rule.activity).nextStartedActivity?.action)

        // Asked again: refused once, so straight to the system dialog; refused again, so Settings again.
        tapShareOnHome()
        rule.onNodeWithText("Location is off for Track Me Live").assertIsDisplayed()
        assertEquals(PermissionStatus.DeniedForever, permissions.state.value.location)
        rule.onNodeWithText("Not now").performClick()
        rule.onNodeWithText("Location is off for Track Me Live").assertDoesNotExist()
        rule.onNodeWithText("Not on a call").assertIsDisplayed()
        assertTrue(sharing.createRequests.isEmpty())
    }

    @Test
    fun notNowOnTheExplainerAsksNothing() {
        show()
        tapShareOnHome()
        rule.onNodeWithText("Not now").performClick()
        rule.waitForIdle()
        assertTrue(launched.isEmpty())
        rule.onNodeWithText("Allow location to share").assertDoesNotExist()
    }

    @Test
    fun theLimitEndsTheShareAndShareAgainSendsANewLink() {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted
        show()
        tapShareOnHome()
        rule.onNode(hasText("Share live location") and hasClickAction()).performClick()
        rule.waitUntil { rule.onAllNodes(hasText("Stop sharing")).fetchSemanticsNodes().isNotEmpty() }

        // Away on Home when the hour runs out: the ended screen comes up by itself.
        rule.activity.onBackPressedDispatcher.onBackPressed()
        sharing.endWith(EndReason.LIMIT)
        rule.onNodeWithText("Sharing stopped after 1 hour").assertIsDisplayed()
        rule.onNode(hasText("Share again") and hasClickAction()).performClick()
        rule.waitUntil { sharing.createRequests.size == 2 }
        rule.waitUntil { rule.onAllNodes(hasText("Stop sharing")).fetchSemanticsNodes().isNotEmpty() }
        assertEquals(1, sharing.dismissals)
    }

    @Test
    fun aTimerEndingOnTheLiveMapMovesOnToTheEndedScreen() {
        permissions.mutableState.value = FakeLocationPermissions.AllGranted
        show()
        tapShareOnHome()
        rule.onNode(hasText("Share live location") and hasClickAction()).performClick()
        rule.waitUntil { rule.onAllNodes(hasText("Stop sharing")).fetchSemanticsNodes().isNotEmpty() }
        sharing.endWith(EndReason.TIMER)
        rule.onNodeWithText("Your timer ran out, so sharing stopped.").assertIsDisplayed()
        // Back on the ended screen is Done.
        rule.activity.onBackPressedDispatcher.onBackPressed()
        rule.onNodeWithText("Not on a call").assertIsDisplayed()
        assertEquals(1, sharing.dismissals)
    }

    @Test
    fun settingsLocationRowAsksTheFirstTime() {
        show()
        rule.onNodeWithText("Settings").performClick()
        rule.onNode(hasText("Location") and hasText("Not set") and hasClickAction()).performScrollTo().performClick()
        rule.waitUntil { rule.onAllNodes(hasText("Allow location to share")).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("Allow location to share").assertIsDisplayed()
        rule.onNodeWithText("Continue").performClick()
        rule.waitUntil { permissions.state.value.location == PermissionStatus.Granted }
        rule.onNodeWithText("While using the app").assertIsDisplayed()
    }
}
