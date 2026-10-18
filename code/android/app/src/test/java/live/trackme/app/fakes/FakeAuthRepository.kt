package live.trackme.app.fakes

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import live.trackme.app.data.auth.AuthRepository
import live.trackme.app.data.auth.SendCodeResult
import live.trackme.app.data.auth.VerifyCodeResult

/**
 * Phone sign-in that accepts [validCode] for whichever number was sent last. Each result can be
 * overridden for one call, and [sendGate] can hold a send open to observe the in-flight state.
 *
 * [currentUserId] changes the moment a sign-in or sign-out completes, as FirebaseAuth.currentUser does.
 * With [userIdTrails], [userId] doesn't follow until [settle], like a listener that hasn't been called
 * yet, so tests can prove nothing reads it right after a transition.
 */
class FakeAuthRepository(
    signedInAs: String? = null,
    var validCode: String = "123456",
    private val uid: String = "user-1",
    var userIdTrails: Boolean = false,
) : AuthRepository {
    private val user = MutableStateFlow(signedInAs)
    override val userId: StateFlow<String?> = user
    private var current: String? = signedInAs

    override fun currentUserId(): String? = current

    /** The trailing [userId] catches up with who is signed in now. */
    fun settle() {
        user.value = current
    }

    private fun signedIn(id: String?) {
        current = id
        if (!userIdTrails) user.value = id
    }

    val retrieved = MutableSharedFlow<String>(extraBufferCapacity = 1)
    override val retrievedCodes: Flow<String> = retrieved

    val sent = mutableListOf<Pair<String, Boolean>>()
    val verified = mutableListOf<String>()
    var signOuts = 0

    /** The next sendCode's result; CodeSent when null. */
    var nextSend: SendCodeResult? = null

    /** The next verifyCode's result, instead of checking [validCode]. */
    var nextVerify: VerifyCodeResult? = null

    /** When set, sendCode waits for it before answering. */
    var sendGate: CompletableDeferred<Unit>? = null

    override suspend fun sendCode(e164: String, resend: Boolean): SendCodeResult {
        sent += e164 to resend
        sendGate?.await()
        val result = nextSend ?: SendCodeResult.CodeSent
        nextSend = null
        if (result is SendCodeResult.SignedIn) signedIn(result.userId)
        return result
    }

    override suspend fun verifyCode(code: String): VerifyCodeResult {
        verified += code
        val result = nextVerify ?: if (code == validCode) VerifyCodeResult.SignedIn(uid) else VerifyCodeResult.Wrong
        nextVerify = null
        if (result is VerifyCodeResult.SignedIn) signedIn(result.userId)
        return result
    }

    override suspend fun signOut() {
        signOuts++
        signedIn(null)
    }
}
