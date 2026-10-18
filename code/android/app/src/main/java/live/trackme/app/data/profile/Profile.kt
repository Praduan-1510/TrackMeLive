package live.trackme.app.data.profile

import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotCatalog
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.UserSettings

/**
 * The signed-in person's profile (users/{uid}, FSD §6), as the app shows it. Immutable: change it with
 * copy() and save it with [ProfileRepository.update]. The phone number is never part of it.
 */
data class Profile(
    val name: String,
    val mascotId: MascotId = MascotCatalog.DEFAULT_MASCOT,
    val mascotColor: MascotColor = MascotCatalog.DEFAULT_COLOR,
    val mascotAccessory: MascotAccessory? = null,
    val settings: UserSettings = UserSettings(),
    /** Server-owned: the last "who it's for" name (createSession sets it). Read-only here. */
    val lastViewerName: String? = null,
    /** Server-owned: the active share, or null. Read-only here. */
    val activeSessionId: String? = null,
    /** Server time of the last write, in epoch milliseconds; 0 when unknown. */
    val updatedAtMillis: Long = 0,
)

/** What [ProfileRepository.profile] knows about the signed-in person's profile. */
sealed interface ProfileState {
    /** Nobody is signed in. */
    data object SignedOut : ProfileState

    /** Signed in; the profile hasn't loaded yet. */
    data object Loading : ProfileState

    /** Signed in, and the server has no profile for this account. */
    data object Missing : ProfileState

    data class Ready(val profile: Profile) : ProfileState
}

sealed interface SaveProfileResult {
    data class Saved(val profile: Profile) : SaveProfileResult

    data class Failed(val reason: ProfileFailure) : SaveProfileResult
}

sealed interface FetchProfileResult {
    data class Found(val profile: Profile) : FetchProfileResult

    data object NotFound : FetchProfileResult

    data class Failed(val reason: ProfileFailure) : FetchProfileResult
}

/** Why reading or saving the profile failed. */
enum class ProfileFailure {
    /** No connection, or the server didn't answer in time. */
    Network,

    /** The server rejected the name (1 to 24 characters after trimming). */
    InvalidName,

    /** The server rejected another field. A bug on our side, never the person's doing. */
    Invalid,

    /** Nobody is signed in, or the sign-in isn't a phone sign-in. */
    NotSignedIn,

    /**
     * The server says the sign-in has ended (a callable answered unauthenticated: the account was
     * deleted, disabled or its sign-in revoked). The app treats it as signed out.
     */
    SignInEnded,

    /** There is no profile yet to change. */
    NoProfile,

    /** The account is being deleted: saves are refused so nothing recreates users/{uid}. */
    AccountDeleting,

    Other,
}
