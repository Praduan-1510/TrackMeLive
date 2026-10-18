package live.trackme.app.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import live.trackme.app.TrackMeLiveApplication
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.fakes.FakeAppContainer
import live.trackme.app.ui.navigation.AppViewModel
import live.trackme.app.ui.navigation.TrackMeLiveApp
import live.trackme.schema.MascotId
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The whole app as one piece, on fakes: the real root (Navigation 3, each screen's view models made by
 * their factories from the app container) from onboarding through sign-up and the first mascot pick
 * to Home. This is what catches wiring that unit tests of single screens can't.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp-xxhdpi")
class AppFlowTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val container = FakeAppContainer(scope).also {
        ApplicationProvider.getApplicationContext<TrackMeLiveApplication>().useContainer(it)
    }

    @After
    fun tearDown() = scope.cancel()

    private fun show() {
        val app = AppViewModel(container.preferences, container.auth, container.sharing)
        rule.setContent { TrackMeLiveApp(app) }
    }

    @Test
    fun fromOnboardingToHome() {
        show()
        rule.onNodeWithText("Share where you are, the moment you’re on the phone.").assertIsDisplayed()
        rule.onNodeWithText("Skip").performClick()
        rule.waitUntil { container.preferences.setupStage.value == SetupStage.SignUp }

        rule.onNode(hasSetTextAction() and hasText("Name")).performTextInput("Alex")
        rule.onNode(hasSetTextAction() and hasText("Mobile number")).performTextInput("4155550142")
        rule.onNodeWithText("Send code").performClick()
        rule.onNode(hasContentDescription("6-digit code")).performTextInput("123456")

        // New account: saveProfile, then the mascot pick.
        rule.waitUntil { container.preferences.setupStage.value == SetupStage.Mascot }
        assertEquals("Alex", container.profileSource.saves.first().first.name)
        rule.waitUntil(5_000) { rule.onAllNodes(hasText("Continue")).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("Continue").performClick()

        rule.waitUntil { container.preferences.setupStage.value == SetupStage.Done }
        rule.onNodeWithText("Hi, Alex", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Not on a call").assertIsDisplayed()
        assertEquals(MascotId.FOX, container.profileSource.stored?.mascotId)
    }

    @Test
    fun aSignedInPersonOpensOnHome() {
        container.preferences.setupStage.value = SetupStage.Done
        runBlocking { container.auth.verifyCode(container.auth.validCode) } // signed in
        container.profileSource.stored = Profile(name = "Mia")
        container.profileSource.deliver()
        show()
        rule.onNodeWithText("Hi, Mia", substring = true).assertIsDisplayed()
    }

    @Test
    fun backFromSignUpReturnsToTheLastOnboardingPage() {
        container.preferences.setupStage.value = SetupStage.SignUp
        show()
        rule.onNode(hasContentDescription("Back")).performClick()
        rule.onNodeWithText("Private by default").assertIsDisplayed()
        rule.onNodeWithText("Get started").assertIsDisplayed()
    }
}
