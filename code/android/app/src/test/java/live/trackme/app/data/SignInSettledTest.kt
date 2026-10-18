package live.trackme.app.data

import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.auth.AccountSession
import live.trackme.app.data.auth.VerifyCodeResult
import live.trackme.app.data.profile.DefaultProfileRepository
import live.trackme.app.data.profile.FetchProfileResult
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.RemoteProfile
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.data.sharing.DefaultPushRegistration
import live.trackme.app.data.sharing.DeviceRegistry
import live.trackme.app.domain.PhoneNumbers
import live.trackme.app.fakes.FakeAuthRepository
import live.trackme.app.fakes.FakeClock
import live.trackme.app.fakes.FakeLocalPreferences
import live.trackme.app.fakes.FakeProfileDataSource
import live.trackme.app.fakes.MainDispatcherRule
import live.trackme.app.ui.signup.SignUpViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Right after a sign-in, the observed sign-in (AuthRepository.userId, fed by Firebase's listener) can
 * still say signed out. Everything that runs at that moment reads the settled answer instead
 * (currentUserId). Here the fake's userId doesn't follow until settle(), so any reader of it fails.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class SignInSettledTest {
    @get:Rule val main = MainDispatcherRule()

    @Test
    fun `a verified code creates the profile for that account, with no sign-out, before userId catches up`() = runTest(main.dispatcher.scheduler) {
        val auth = FakeAuthRepository(userIdTrails = true)
        val source = FakeProfileDataSource(RemoteProfile.Missing)
        val profiles = DefaultProfileRepository(auth.userId, auth::currentUserId, source, backgroundScope)
        val prefs = FakeLocalPreferences(SetupStage.SignUp)
        val vm = SignUpViewModel(auth, profiles, prefs, PhoneNumbers(), FakeClock(testScheduler), "US", SavedStateHandle())

        vm.onNameChange("Alex")
        vm.onPhoneChange("4155550142")
        vm.sendCode()
        advanceUntilIdle()
        vm.onCodeChange("123456")
        advanceUntilIdle()

        assertEquals(null, auth.userId.value) // still trailing
        assertEquals(listOf("user-1"), source.fetchedFor)
        assertEquals("Alex", source.saves.single().first.name)
        assertEquals(0, auth.signOuts)
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)

        auth.settle()
        advanceUntilIdle()
        assertEquals(SetupStage.Mascot, prefs.setupStage.value)
        assertEquals(0, auth.signOuts)
    }

    @Test
    fun `fetch, create and update use the settled account`() = runTest {
        val user = MutableStateFlow<String?>(null)
        val source = FakeProfileDataSource(RemoteProfile.Present(Profile(name = "Alex")))
        val profiles = DefaultProfileRepository(user, { "u1" }, source, backgroundScope)
        assertTrue(profiles.fetch() is FetchProfileResult.Found)
        assertEquals(listOf("u1"), source.fetchedFor)
        assertTrue(profiles.create("Sam") is SaveProfileResult.Saved)
        // Signed out for real, settled: refused without reaching the server.
        val signedOut = DefaultProfileRepository(MutableStateFlow("u1"), { null }, source, backgroundScope)
        assertEquals(FetchProfileResult.Failed(ProfileFailure.NotSignedIn), signedOut.fetch())
    }

    @Test
    fun `an ended sign-in right after signing in still signs out`() = runTest {
        val auth = FakeAuthRepository(userIdTrails = true)
        val prefs = FakeLocalPreferences(SetupStage.SignUp)
        val profiles = DefaultProfileRepository(auth.userId, auth::currentUserId, FakeProfileDataSource(RemoteProfile.Missing), backgroundScope)
        val session = AccountSession(auth, prefs, { profiles }, clearLocalCache = {})
        assertTrue(auth.verifyCode("123456") is VerifyCodeResult.SignedIn)
        session.signInEnded()
        assertEquals(1, auth.signOuts)
        assertTrue(session.pending.value)
    }

    @Test
    fun `the device doc is written for the account just signed in`() = runTest {
        val auth = FakeAuthRepository(userIdTrails = true)
        val writes = mutableListOf<String>()
        val registry = object : DeviceRegistry {
            override suspend fun write(userId: String, deviceId: String, pushToken: String) {
                writes += userId
            }

            override suspend fun delete(userId: String, deviceId: String) = Unit
        }
        val push = DefaultPushRegistration(auth.userId, auth::currentUserId, MutableStateFlow(true), { "tok" }, registry, { "d" }, backgroundScope)
        auth.verifyCode("123456")
        push.ensureRegistered()
        runCurrent()
        assertEquals(listOf("user-1"), writes)
    }
}
