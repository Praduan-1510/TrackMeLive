package live.trackme.app.data.profile

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * [ProfileRepository] over a [ProfileDataSource], for whoever [userId] says is signed in.
 *
 * Saves are optimistic and serialized: [profile] shows a change the moment its save starts. Once the
 * server confirms, the confirmed profile stays on screen until the live listener catches up (its
 * `updated_at` reaches the confirmed one), so the screen never flickers back to the old value. A
 * failed save reverts to what was there before it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DefaultProfileRepository(
    /** Who is signed in, observed over time: drives the users/{uid} listener. */
    private val userId: StateFlow<String?>,
    /**
     * Who is signed in right now, settled (AuthRepository.currentUserId). fetch, create and update read
     * this: they run right after a sign-in, when [userId] may not have caught up yet.
     */
    private val currentUserId: () -> String?,
    private val source: ProfileDataSource,
    private val scope: CoroutineScope,
    /** Called when saveProfile says the sign-in has ended, to treat it as signed out (AccountSession). */
    private val onSignInEnded: suspend () -> Unit = {},
) : ProfileRepository {

    /** A profile saved (or being saved) that the listener hasn't delivered yet. */
    private data class Overlay(val uid: String, val profile: Profile, val confirmedAtMillis: Long?)

    private val overlay = MutableStateFlow<Overlay?>(null)
    private val saves = Mutex()
    private val unavailable = MutableStateFlow(false)
    private val savesBlocked = MutableStateFlow(false)
    override val updatesUnavailable: StateFlow<Boolean> = unavailable.asStateFlow()

    private val remote: StateFlow<Pair<String?, RemoteProfile>> = userId
        .flatMapLatest { uid ->
            if (uid == null) {
                unavailable.value = false
                flowOf(null to RemoteProfile.Missing)
            } else {
                observeWithRetry(uid).map { uid to it }
            }
        }
        .stateIn(scope, SharingStarted.Eagerly, userId.value to RemoteProfile.Loading)

    /**
     * users/{uid}, kept alive: when the listener fails it starts again after 2, 4, 8, 16 and 32 s, then
     * every 60 s, until a snapshot gets through (which resets the backoff). The last known profile
     * stays meanwhile. "Sign-in ended" isn't retried: it signs out (AccountSession), which ends this.
     * Signing out cancels it, waits included.
     */
    private fun observeWithRetry(uid: String): Flow<RemoteProfile> = flow {
        var failures = 0
        while (true) {
            var failure: ProfileFailure = ProfileFailure.Other
            source.observe(uid).collect { snapshot ->
                if (snapshot is RemoteProfile.Failed) {
                    failure = snapshot.reason
                } else {
                    failures = 0
                    unavailable.value = false
                    emit(snapshot)
                }
            }
            if (failure == ProfileFailure.SignInEnded) {
                onSignInEnded()
                return@flow
            }
            failures++
            // Quiet at first: say so only once the first retry has failed too.
            if (failures >= 2) unavailable.value = true
            delay(retryDelayMillis(failures))
        }
    }

    override val profile: StateFlow<ProfileState> = combine(remote, overlay) { (uid, snapshot), over ->
        when {
            uid == null -> ProfileState.SignedOut
            over != null && over.uid == uid && !caughtUp(over, snapshot) -> ProfileState.Ready(over.profile)
            snapshot is RemoteProfile.Present -> ProfileState.Ready(snapshot.profile)
            snapshot is RemoteProfile.Missing -> ProfileState.Missing
            else -> ProfileState.Loading
        }
    }.stateIn(
        scope,
        SharingStarted.Eagerly,
        if (userId.value == null) ProfileState.SignedOut else ProfileState.Loading,
    )

    init {
        // Drop the overlay once the listener has caught up with it, or when someone else signs in.
        scope.launch {
            remote.collect { (uid, snapshot) ->
                overlay.update { over -> if (over == null || over.uid != uid || caughtUp(over, snapshot)) null else over }
            }
        }
    }

    internal companion object {
        /** After the nth failure in a row: 2, 4, 8, 16, 32 s, then every 60 s. */
        fun retryDelayMillis(failures: Int): Long = if (failures >= 6) 60_000L else 1_000L shl failures.coerceAtLeast(1)
    }

    private fun caughtUp(over: Overlay, snapshot: RemoteProfile): Boolean {
        val confirmedAt = over.confirmedAtMillis ?: return false
        return snapshot is RemoteProfile.Present && snapshot.profile.updatedAtMillis >= confirmedAt
    }

    override suspend fun fetch(): FetchProfileResult {
        val uid = currentUserId() ?: return FetchProfileResult.Failed(ProfileFailure.NotSignedIn)
        return try {
            source.fetch(uid)?.let { FetchProfileResult.Found(it) } ?: FetchProfileResult.NotFound
        } catch (e: ProfileDataException) {
            FetchProfileResult.Failed(e.reason)
        }
    }

    override suspend fun <T> withSavesBlocked(block: suspend () -> T): T {
        savesBlocked.value = true
        try {
            return saves.withLock { block() }
        } finally {
            savesBlocked.value = false
        }
    }

    override suspend fun create(name: String): SaveProfileResult {
        if (savesBlocked.value) return SaveProfileResult.Failed(ProfileFailure.AccountDeleting)
        return saves.withLock { createLocked(name) }
    }

    private suspend fun createLocked(name: String): SaveProfileResult {
        if (savesBlocked.value) return SaveProfileResult.Failed(ProfileFailure.AccountDeleting)
        val uid = currentUserId() ?: return SaveProfileResult.Failed(ProfileFailure.NotSignedIn)
        return save(uid, before = overlay.value, next = Profile(name = name.trim()), includeSettings = false)
    }

    override suspend fun update(change: (Profile) -> Profile): SaveProfileResult {
        if (savesBlocked.value) return SaveProfileResult.Failed(ProfileFailure.AccountDeleting)
        return saves.withLock { updateLocked(change) }
    }

    private suspend fun updateLocked(change: (Profile) -> Profile): SaveProfileResult {
        // Asked for before the delete began, but its turn came after: refused all the same.
        if (savesBlocked.value) return SaveProfileResult.Failed(ProfileFailure.AccountDeleting)
        val uid = currentUserId() ?: return SaveProfileResult.Failed(ProfileFailure.NotSignedIn)
        val current = (profile.value as? ProfileState.Ready)?.profile
            ?: return SaveProfileResult.Failed(ProfileFailure.NoProfile)
        val next = change(current)
        if (next == current) return SaveProfileResult.Saved(current)
        // Settings travel only when they changed, so a mascot save never overwrites settings changed elsewhere.
        return save(uid, before = overlay.value, next = next, includeSettings = next.settings != current.settings)
    }

    private suspend fun save(uid: String, before: Overlay?, next: Profile, includeSettings: Boolean): SaveProfileResult {
        overlay.value = Overlay(uid, next, confirmedAtMillis = null)
        return try {
            val saved = source.save(next, includeSettings)
            val confirmed = Overlay(uid, saved, confirmedAtMillis = saved.updatedAtMillis)
            // The listener may already have delivered this save; then there's nothing left to overlay.
            overlay.value = if (caughtUp(confirmed, remote.value.second)) null else confirmed
            SaveProfileResult.Saved(saved)
        } catch (e: CancellationException) {
            overlay.value = before
            throw e
        } catch (e: ProfileDataException) {
            overlay.value = before
            // Outside this save's lock: signing out waits for the profile to settle.
            if (e.reason == ProfileFailure.SignInEnded) scope.launch { onSignInEnded() }
            SaveProfileResult.Failed(e.reason)
        }
    }
}
