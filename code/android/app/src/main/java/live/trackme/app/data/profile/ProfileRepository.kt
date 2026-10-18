package live.trackme.app.data.profile

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The signed-in person's profile: read live from users/{uid} and saved only through the saveProfile
 * callable (clients can't write users directly). Every save sends the whole profile, so saves run one
 * at a time, each on top of the one before.
 */
interface ProfileRepository {
    /** The signed-in person's profile, live. Shows a save as soon as it starts, and reverts if it fails. */
    val profile: StateFlow<ProfileState>

    /**
     * True while the live profile can't be updated: the listener failed and its first retry failed too.
     * The last known profile stays shown meanwhile. False again once a snapshot gets through.
     */
    val updatesUnavailable: StateFlow<Boolean>

    /** Reads the profile once from the server, to restore it when someone signs in on a new phone. */
    suspend fun fetch(): FetchProfileResult

    /** Creates the profile for a new account: the name, with Fox and the default settings. */
    suspend fun create(name: String): SaveProfileResult

    /** Applies [change] to the current profile and saves the result. */
    suspend fun update(change: (Profile) -> Profile): SaveProfileResult

    /**
     * Runs [block] (deleting the account) with profile saves shut: a save already running finishes
     * first, and any save asked for meanwhile fails with [ProfileFailure.AccountDeleting] without
     * reaching the server, so nothing can recreate users/{uid} mid-delete.
     */
    suspend fun <T> withSavesBlocked(block: suspend () -> T): T
}

/** One read of users/{uid}, as the data source sees it. */
sealed interface RemoteProfile {
    /** Nothing from the server yet (and nothing cached). */
    data object Loading : RemoteProfile

    data object Missing : RemoteProfile

    data class Present(val profile: Profile) : RemoteProfile

    /** The listener stopped with an error; it emits nothing after this. */
    data class Failed(val reason: ProfileFailure) : RemoteProfile
}

/** Where profiles live: Firestore and the saveProfile callable in the app, a fake in tests. */
interface ProfileDataSource {
    /** users/{uid}, live. An error ends the flow with [RemoteProfile.Failed]. */
    fun observe(uid: String): Flow<RemoteProfile>

    /** users/{uid}, read once from the server; null when there's none. Throws [ProfileDataException]. */
    suspend fun fetch(uid: String): Profile?

    /**
     * Saves [profile] whole through saveProfile and returns what the server stored. Settings go only
     * with [includeSettings]; otherwise the server keeps the stored ones (or the defaults for a new
     * profile). Throws [ProfileDataException].
     */
    suspend fun save(profile: Profile, includeSettings: Boolean): Profile
}

class ProfileDataException(val reason: ProfileFailure, cause: Throwable? = null) : Exception(reason.name, cause)
