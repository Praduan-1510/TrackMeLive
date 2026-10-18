package live.trackme.app.fakes

import kotlinx.coroutines.flow.MutableStateFlow
import live.trackme.app.data.profile.FetchProfileResult
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.profile.SaveProfileResult

/** A profile repository in memory, for view model tests. */
class FakeProfileRepository(
    initial: ProfileState = ProfileState.Missing,
    /** What fetch() finds on the server (a returning user's profile), or null for a new account. */
    var onServer: Profile? = null,
) : ProfileRepository {
    override val profile = MutableStateFlow(initial)
    override val updatesUnavailable = MutableStateFlow(false)
    val created = mutableListOf<String>()
    val updates = mutableListOf<Profile>()
    var failFetch: ProfileFailure? = null
    var failSave: ProfileFailure? = null

    override suspend fun fetch(): FetchProfileResult {
        failFetch?.let {
            failFetch = null
            return FetchProfileResult.Failed(it)
        }
        return onServer?.let { FetchProfileResult.Found(it) } ?: FetchProfileResult.NotFound
    }

    override suspend fun create(name: String): SaveProfileResult {
        created += name
        failSave?.let {
            failSave = null
            return SaveProfileResult.Failed(it)
        }
        val p = Profile(name = name.trim())
        profile.value = ProfileState.Ready(p)
        return SaveProfileResult.Saved(p)
    }

    var savesBlocked = false

    override suspend fun <T> withSavesBlocked(block: suspend () -> T): T {
        savesBlocked = true
        try {
            return block()
        } finally {
            savesBlocked = false
        }
    }

    override suspend fun update(change: (Profile) -> Profile): SaveProfileResult {
        if (savesBlocked) return SaveProfileResult.Failed(ProfileFailure.AccountDeleting)
        val current = (profile.value as? ProfileState.Ready)?.profile ?: return SaveProfileResult.Failed(ProfileFailure.NoProfile)
        failSave?.let {
            failSave = null
            return SaveProfileResult.Failed(it)
        }
        val next = change(current)
        updates += next
        profile.value = ProfileState.Ready(next)
        return SaveProfileResult.Saved(next)
    }
}
