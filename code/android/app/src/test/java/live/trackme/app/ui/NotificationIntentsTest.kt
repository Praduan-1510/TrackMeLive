package live.trackme.app.ui

import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import live.trackme.app.MainActivity
import live.trackme.app.TrackMeLiveApplication
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UploadStatus
import live.trackme.app.fakes.FakeAppContainer
import live.trackme.app.fakes.FakeLocationPermissions
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.app.service.SharingIntents
import live.trackme.schema.EndReason
import live.trackme.schema.Precision
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The ongoing notification's taps (FSD §8): Open lands on the live map; Stop sharing lands there with
 * the Stop dialog asking first. Both from a cold start and with the app already open.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp-xxhdpi")
class NotificationIntentsTest {
    @get:Rule val rule = createEmptyComposeRule()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val container = FakeAppContainer(scope, locationPermissions = FakeLocationPermissions(FakeLocationPermissions.AllGranted)).also {
        ApplicationProvider.getApplicationContext<TrackMeLiveApplication>().useContainer(it)
    }
    private val sharing get() = container.sharing
    private var activity: ActivityController<MainActivity>? = null

    @Before
    fun signedInAndSharing() {
        container.preferences.setupStage.value = SetupStage.Done
        runBlocking { container.auth.verifyCode(container.auth.validCode) }
        container.profileSource.stored = Profile(name = "Alex")
        container.profileSource.deliver()
        val request = ShareRequest(StopChoice.AtLimit, Precision.PRECISE, false, viewerName = "Mom")
        val share = FakeSharingRepository.shareFor(request)
        sharing.emit(ShareState.Live(share, FakeSharingRepository.sessionFor(share, request), UploadStatus.Initial))
    }

    @After
    fun tearDown() {
        activity?.pause()?.stop()?.destroy()
        scope.cancel()
    }

    private fun intent(action: String?) =
        Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java).setAction(action)

    private fun launch(action: String?) {
        activity = Robolectric.buildActivity(MainActivity::class.java, intent(action)).setup()
    }

    @Test
    fun openFromAColdStartShowsTheLiveMap() {
        launch(SharingIntents.ACTION_OPEN_SHARE)
        rule.onNodeWithText("Link sent to Mom. You’ll know when it’s opened.").assertIsDisplayed()
        rule.onNodeWithText("Stop sharing your location?").assertDoesNotExist()
    }

    @Test
    fun stopSharingFromAColdStartAsksFirst() {
        launch(SharingIntents.ACTION_CONFIRM_STOP)
        rule.onNodeWithText("Stop sharing your location?").assertIsDisplayed()
        assertEquals("nothing stops without the answer", 0, sharing.stops)
        assertFalse(sharing.stopConfirmationRequested.value)
        rule.onNodeWithText("Stop").performClick()
        rule.onNodeWithText("Sharing ended").assertIsDisplayed()
        assertEquals(1, sharing.stops)
    }

    @Test
    fun withTheAppOpenOnHomeOpenAndStopLandOnTheLiveMap() {
        launch(Intent.ACTION_MAIN)
        rule.onNodeWithText("Sharing with Mom").assertIsDisplayed()

        activity!!.newIntent(intent(SharingIntents.ACTION_OPEN_SHARE))
        rule.onNodeWithText("Link sent to Mom. You’ll know when it’s opened.").assertIsDisplayed()

        activity!!.get().onBackPressedDispatcher.onBackPressed()
        rule.onNodeWithText("Sharing with Mom").assertIsDisplayed()

        activity!!.newIntent(intent(SharingIntents.ACTION_CONFIRM_STOP))
        rule.onNodeWithText("Stop sharing your location?").assertIsDisplayed()
        rule.onNodeWithText("Cancel").performClick()
        rule.onNodeWithText("Stop sharing your location?").assertDoesNotExist()
        assertEquals(0, sharing.stops)
    }

    @Test
    fun aTapAfterTheShareEndedStaysOnTheEndedScreen() {
        sharing.endWith(EndReason.TIMER)
        launch(SharingIntents.ACTION_CONFIRM_STOP)
        rule.onNodeWithText("Your timer ran out, so sharing stopped.").assertIsDisplayed()
        rule.onNodeWithText("Stop sharing your location?").assertDoesNotExist()
        assertFalse(sharing.stopConfirmationRequested.value)
    }

    @Test
    fun theLauncherOpensHome() {
        launch(Intent.ACTION_MAIN)
        rule.onNodeWithText("Sharing with Mom").assertIsDisplayed()
        rule.onNodeWithText("Link sent to Mom. You’ll know when it’s opened.").assertDoesNotExist()
    }
}
