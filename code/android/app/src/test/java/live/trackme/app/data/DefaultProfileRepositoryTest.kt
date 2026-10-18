package live.trackme.app.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.data.profile.DefaultProfileRepository
import live.trackme.app.data.profile.FetchProfileResult
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.profile.RemoteProfile
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.fakes.FakeProfileDataSource
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.Precision
import live.trackme.schema.UserSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DefaultProfileRepositoryTest {
    private val alex = Profile(name = "Alex", updatedAtMillis = 500)

    private fun TestScope.repo(
        source: FakeProfileDataSource,
        user: MutableStateFlow<String?> = MutableStateFlow("u1"),
    ) = DefaultProfileRepository(user, { user.value }, source, backgroundScope)

    @Test
    fun followsTheSignedInPersonsProfile() = runTest(UnconfinedTestDispatcher()) {
        val user = MutableStateFlow<String?>(null)
        val source = FakeProfileDataSource(RemoteProfile.Loading)
        val repo = repo(source, user)
        assertEquals(ProfileState.SignedOut, repo.profile.value)
        user.value = "u1"
        assertEquals(ProfileState.Loading, repo.profile.value)
        source.live.value = RemoteProfile.Missing
        assertEquals(ProfileState.Missing, repo.profile.value)
        source.live.value = RemoteProfile.Present(alex)
        assertEquals(ProfileState.Ready(alex), repo.profile.value)
        user.value = null
        assertEquals(ProfileState.SignedOut, repo.profile.value)
    }

    @Test
    fun createSavesTheTrimmedNameWithDefaultsAndNoSettings() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource()
        val repo = repo(source)
        val result = repo.create("  Alex ")
        assertTrue(result is SaveProfileResult.Saved)
        val (sent, includeSettings) = source.saves.single()
        assertEquals(Profile(name = "Alex"), sent)
        assertFalse(includeSettings)
        // Shown before the listener delivers it.
        assertEquals("Alex", (repo.profile.value as ProfileState.Ready).profile.name)
    }

    @Test
    fun aSaveShowsAtOnceAndStaysUntilTheListenerCatchesUp() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex)).apply { stored = alex }
        val repo = repo(source)
        val gate = CompletableDeferred<Unit>()
        source.saveGate = gate

        val save = async { repo.update { it.copy(mascotId = MascotId.NEKO) } }
        // Optimistic: the new mascot shows while the save is in flight.
        assertEquals(MascotId.NEKO, (repo.profile.value as ProfileState.Ready).profile.mascotId)
        gate.complete(Unit)
        assertTrue(save.await() is SaveProfileResult.Saved)

        // The listener hasn't caught up: the confirmed save stays on screen, no flicker back to Fox.
        source.live.value = RemoteProfile.Present(alex)
        assertEquals(MascotId.NEKO, (repo.profile.value as ProfileState.Ready).profile.mascotId)
        source.deliver()
        assertEquals(MascotId.NEKO, (repo.profile.value as ProfileState.Ready).profile.mascotId)
    }

    @Test
    fun aFailedSaveGoesBack() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex)).apply { stored = alex }
        val repo = repo(source)
        source.failNext = ProfileFailure.Network
        val result = repo.update { it.copy(mascotColor = MascotColor.ROSE) }
        assertEquals(SaveProfileResult.Failed(ProfileFailure.Network), result)
        assertEquals(ProfileState.Ready(alex), repo.profile.value)
    }

    @Test
    fun saveProfileAnsweringUnauthenticatedEndsTheSignIn() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex)).apply { stored = alex }
        var ended = 0
        val repo = DefaultProfileRepository(MutableStateFlow("u1"), { "u1" }, source, backgroundScope, onSignInEnded = { ended++ })
        source.failNext = ProfileFailure.SignInEnded
        assertEquals(SaveProfileResult.Failed(ProfileFailure.SignInEnded), repo.update { it.copy(name = "Al") })
        assertEquals(1, ended)
        source.failNext = ProfileFailure.Network
        repo.update { it.copy(name = "Al") }
        assertEquals("other failures don't sign out", 1, ended)
    }

    @Test
    fun aFailedListenerRetriesWithBackoffAndSaysSoAfterTheFirstRetryFails() = runTest {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex))
        repeat(7) { source.listenerFailures.addLast(ProfileFailure.Network) }
        val repo = DefaultProfileRepository(MutableStateFlow("u1"), { "u1" }, source, backgroundScope)
        runCurrent()
        assertEquals(1, source.listenerStarts)
        assertFalse("one failure stays quiet", repo.updatesUnavailable.value)

        // Retries after 2, 4, 8, 16, 32, then 60 s.
        val waits = listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L)
        waits.forEachIndexed { i, wait ->
            advanceTimeBy(wait - 1)
            runCurrent()
            assertEquals("not before ${wait / 1000} s", i + 1, source.listenerStarts)
            advanceTimeBy(1)
            runCurrent()
            assertEquals(i + 2, source.listenerStarts)
            if (i == 0) assertTrue("the first retry failed too", repo.updatesUnavailable.value)
        }
        // The seventh start fails too; the eighth, 60 s later, gets through.
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(8, source.listenerStarts)
        assertFalse(repo.updatesUnavailable.value)
        assertEquals(ProfileState.Ready(alex), repo.profile.value)
    }

    @Test
    fun theLastKnownProfileStaysWhileTheListenerIsDown() = runTest {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex))
        val user = MutableStateFlow<String?>("u1")
        val repo = DefaultProfileRepository(user, { user.value }, source, backgroundScope)
        runCurrent()
        assertEquals(ProfileState.Ready(alex), repo.profile.value)
        // Signing in again restarts the listener, which now fails twice.
        user.value = null
        runCurrent()
        source.listenerFailures.addAll(listOf(ProfileFailure.Network, ProfileFailure.Network))
        user.value = "u1"
        runCurrent()
        advanceTimeBy(2_000)
        runCurrent()
        assertTrue(repo.updatesUnavailable.value)
        // Signing out stops the retries (no more starts) and clears the flag.
        user.value = null
        runCurrent()
        val starts = source.listenerStarts
        advanceTimeBy(600_000)
        runCurrent()
        assertEquals(starts, source.listenerStarts)
        assertFalse(repo.updatesUnavailable.value)
        assertEquals(ProfileState.SignedOut, repo.profile.value)
    }

    @Test
    fun aListenerSayingTheSignInEndedSignsOutInsteadOfRetrying() = runTest {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex))
        source.listenerFailures.addLast(ProfileFailure.SignInEnded)
        var ended = 0
        DefaultProfileRepository(MutableStateFlow("u1"), { "u1" }, source, backgroundScope, onSignInEnded = { ended++ })
        runCurrent()
        advanceTimeBy(120_000)
        runCurrent()
        assertEquals(1, ended)
        assertEquals("no retry", 1, source.listenerStarts)
    }

    @Test
    fun backoffSchedule() {
        assertEquals(
            listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L),
            (1..7).map { DefaultProfileRepository.retryDelayMillis(it) },
        )
    }

    @Test
    fun settingsTravelOnlyWhenTheyChanged() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex)).apply { stored = alex }
        val repo = repo(source)
        repo.update { it.copy(mascotId = MascotId.ROBOT) }
        repo.update { it.copy(settings = UserSettings(precision = Precision.APPROXIMATE)) }
        assertEquals(listOf(false, true), source.saves.map { it.second })
    }

    @Test
    fun savesRunOneAtATimeEachOnTopOfTheLast() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex)).apply { stored = alex }
        val repo = repo(source)
        val gate = CompletableDeferred<Unit>()
        source.saveGate = gate
        val first = async { repo.update { it.copy(mascotId = MascotId.GHOST) } }
        val second = async { repo.update { it.copy(settings = it.settings.copy(shareBack = false)) } }
        runCurrent()
        assertEquals(1, source.saves.size) // the second waits for the first
        gate.complete(Unit)
        first.await()
        second.await()
        // The second save carries the first one's mascot, so neither overwrites the other.
        val last = source.saves.last().first
        assertEquals(MascotId.GHOST, last.mascotId)
        assertFalse(last.settings.shareBack)
    }

    @Test
    fun savesWaitOutAndAreRefusedDuringADelete() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex)).apply { stored = alex }
        val repo = repo(source)
        val gate = CompletableDeferred<Unit>()
        source.saveGate = gate
        // A save already running when the delete starts finishes first.
        val running = async { repo.update { it.copy(mascotId = MascotId.ROBOT) } }
        val order = mutableListOf<String>()
        val delete = async { repo.withSavesBlocked { order += "delete:${source.saves.size}" } }
        // Asked for mid-delete: refused at once, and never sent.
        assertEquals(SaveProfileResult.Failed(ProfileFailure.AccountDeleting), repo.update { it.copy(name = "Al") })
        assertEquals(SaveProfileResult.Failed(ProfileFailure.AccountDeleting), repo.create("Al"))
        gate.complete(Unit)
        running.await()
        delete.await()
        assertEquals(listOf("delete:1"), order)
        assertEquals(1, source.saves.size)
        // After the delete, saves are open again.
        assertTrue(repo.update { it.copy(name = "Alexa") } is SaveProfileResult.Saved)
    }

    @Test
    fun noChangeMeansNoSave() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource(RemoteProfile.Present(alex)).apply { stored = alex }
        val repo = repo(source)
        assertEquals(SaveProfileResult.Saved(alex), repo.update { it })
        assertTrue(source.saves.isEmpty())
    }

    @Test
    fun updateNeedsAProfileAndASignIn() = runTest(UnconfinedTestDispatcher()) {
        val missing = repo(FakeProfileDataSource(RemoteProfile.Missing))
        assertEquals(SaveProfileResult.Failed(ProfileFailure.NoProfile), missing.update { it.copy(name = "B") })
        val signedOut = repo(FakeProfileDataSource(), MutableStateFlow(null))
        assertEquals(SaveProfileResult.Failed(ProfileFailure.NotSignedIn), signedOut.create("Alex"))
        assertEquals(FetchProfileResult.Failed(ProfileFailure.NotSignedIn), signedOut.fetch())
    }

    @Test
    fun fetchReadsTheServer() = runTest(UnconfinedTestDispatcher()) {
        val source = FakeProfileDataSource()
        val repo = repo(source)
        assertEquals(FetchProfileResult.NotFound, repo.fetch())
        source.stored = alex
        assertEquals(FetchProfileResult.Found(alex), repo.fetch())
        source.failFetch = ProfileFailure.Network
        assertEquals(FetchProfileResult.Failed(ProfileFailure.Network), repo.fetch())
    }
}
