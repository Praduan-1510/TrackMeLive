package live.trackme.app.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.auth.AccountSession
import live.trackme.app.data.auth.DefaultAccountRepository
import live.trackme.app.data.auth.DeleteAccountResult
import live.trackme.app.data.profile.DefaultProfileRepository
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.profile.RemoteProfile
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.data.settings.Appearance
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.fakes.FakeAuthRepository
import live.trackme.app.fakes.FakeLocalPreferences
import live.trackme.app.fakes.FakeProfileDataSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Deleting the account, and the server ending the sign-in: what's left on the phone afterwards. */
@OptIn(ExperimentalCoroutinesApi::class)
class DefaultAccountRepositoryTest {
    private val auth = FakeAuthRepository(signedInAs = "u1")
    private val prefs = FakeLocalPreferences(SetupStage.Done, Appearance.Dark)
    private val steps = mutableListOf<String>()

    private fun TestScope.session(): Pair<AccountSession, DefaultProfileRepository> {
        val profiles = DefaultProfileRepository(auth.userId, FakeProfileDataSource(RemoteProfile.Present(Profile(name = "Alex"))), backgroundScope)
        // The cache is cleared only once the profile listener has let go of the account.
        val session = AccountSession(auth, prefs, { profiles }, clearLocalCache = { steps += "cache:${profiles.profile.value}" })
        return session to profiles
    }

    @Test
    fun deletedMeansNothingOfTheAccountIsLeftOnThePhone() = runTest(UnconfinedTestDispatcher()) {
        val (session, profiles) = session()
        val account = DefaultAccountRepository({ steps += "server"; DeleteAccountResult.Deleted }, session, profiles)
        assertEquals(DeleteAccountResult.Deleted, account.deleteAccount())
        assertEquals(listOf("server", "cache:${ProfileState.SignedOut}"), steps)
        assertNull(auth.userId.value)
        assertEquals("back to onboarding", SetupStage.Onboarding, prefs.setupStage.value)
        assertEquals("appearance is the phone's, and stays", Appearance.Dark, prefs.appearance.value)
        assertFalse("no sign-in message after a delete", session.pending.value)
    }

    @Test
    fun aFailedDeleteChangesNothingHere() = runTest(UnconfinedTestDispatcher()) {
        val (session, profiles) = session()
        for (failure in listOf(DeleteAccountResult.Network, DeleteAccountResult.Failed)) {
            assertEquals(failure, DefaultAccountRepository({ failure }, session, profiles).deleteAccount())
        }
        assertEquals(emptyList<String>(), steps)
        assertEquals("u1", auth.userId.value)
        assertEquals(SetupStage.Done, prefs.setupStage.value)
    }

    @Test
    fun oneDeleteAtATimeAndNoSavesWhileItRuns() = runTest(UnconfinedTestDispatcher()) {
        val (session, profiles) = session()
        val server = CompletableDeferred<DeleteAccountResult>()
        var calls = 0
        val account = DefaultAccountRepository({ calls++; server.await() }, session, profiles)

        val first = async { account.deleteAccount() }
        assertTrue(account.deleting.value)
        // A second confirm, and a settings change, while the first delete runs.
        assertEquals(DeleteAccountResult.InProgress, account.deleteAccount())
        assertEquals(SaveProfileResult.Failed(ProfileFailure.AccountDeleting), profiles.update { it.copy(name = "Al") })

        server.complete(DeleteAccountResult.Deleted)
        assertEquals(DeleteAccountResult.Deleted, first.await())
        assertEquals("the server was asked once", 1, calls)
        assertFalse(account.deleting.value)
    }

    @Test
    fun anEndedSignInIsTreatedAsSignedOutWithAMessageOnce() = runTest(UnconfinedTestDispatcher()) {
        val (session, _) = session()
        session.signInEnded()
        assertNull(auth.userId.value)
        assertEquals("to sign-up, not onboarding", SetupStage.SignUp, prefs.setupStage.value)
        assertEquals(Appearance.Dark, prefs.appearance.value)
        assertEquals(listOf("cache:${ProfileState.SignedOut}"), steps)
        assertTrue(session.pending.value)
        session.consume()
        assertFalse(session.pending.value)
        // Already signed out: nothing more happens.
        session.signInEnded()
        assertFalse(session.pending.value)
        assertEquals(1, steps.size)
    }

    @Test
    fun deleteAnsweredUnauthenticatedEndsTheSignIn() = runTest(UnconfinedTestDispatcher()) {
        val (session, profiles) = session()
        assertEquals(DeleteAccountResult.SignInEnded, DefaultAccountRepository({ DeleteAccountResult.SignInEnded }, session, profiles).deleteAccount())
        assertNull(auth.userId.value)
        assertTrue(session.pending.value)
    }
}
