package live.trackme.app.data.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.settings.LocalPreferences
import live.trackme.app.data.settings.SetupStage

/**
 * Ending the account's presence on this phone, for the two ways that happens: the person deleted the
 * account, or the server says the sign-in has ended (a callable answered unauthenticated: the account
 * was deleted elsewhere, disabled, or its sign-in revoked).
 *
 * Either way the phone forgets the account: the stored setup stage goes (appearance stays, it's the
 * phone's), the phone signs out, and Firestore's on-device cache is deleted once the profile listener
 * has let go. A deleted account starts again at onboarding; an ended sign-in goes to sign-up, which
 * says "Your sign-in has ended. Sign in again." once.
 */
/** "Your sign-in has ended. Sign in again.", waiting to be shown once on sign-up. */
interface SignInEndedNotice {
    /** True from when the sign-in ends until sign-up has shown the message. */
    val pending: StateFlow<Boolean>

    /** Sign-up has shown the message. */
    fun consume()
}

class AccountSession(
    private val auth: AuthRepository,
    private val preferences: LocalPreferences,
    private val profiles: () -> ProfileRepository,
    private val clearLocalCache: suspend () -> Unit,
) : SignInEndedNotice {
    private val signInEnded = MutableStateFlow(false)
    override val pending: StateFlow<Boolean> = signInEnded.asStateFlow()

    override fun consume() {
        signInEnded.value = false
    }

    /** The server said the sign-in has ended: forget the account here and send the person to sign-up. */
    suspend fun signInEnded() {
        if (auth.currentUserId() == null) return
        forget(then = SetupStage.SignUp)
        signInEnded.value = true
    }

    /** The account was deleted: forget it here; the app starts again at onboarding. */
    suspend fun accountDeleted() = forget(then = SetupStage.Onboarding)

    private suspend fun forget(then: SetupStage) {
        // Local data first, so the root never sees "signed out after setup"; then the sign-in; then the
        // cache, once the users/{uid} listener has stopped. Nothing writes to Firestore in between.
        preferences.clearAccountData()
        if (then != SetupStage.Onboarding) preferences.setSetupStage(then)
        auth.signOut()
        withTimeoutOrNull(LISTENER_STOP_TIMEOUT_MS) { profiles().profile.first { it == ProfileState.SignedOut } }
        clearLocalCache()
    }

    private companion object {
        const val LISTENER_STOP_TIMEOUT_MS = 5_000L
    }
}
