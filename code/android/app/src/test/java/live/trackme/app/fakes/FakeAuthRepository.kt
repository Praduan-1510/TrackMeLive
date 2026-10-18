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
 */
class FakeAuthRepository(
    signedInAs: String? = null,
    var validCode: String = "123456",
    private val uid: String = "user-1",
) : AuthRepository {
    private val user = MutableStateFlow(signedInAs)
    override val userId: StateFlow<String?> = user

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
        if (result is SendCodeResult.SignedIn) user.value = result.userId
        return result
    }

    override suspend fun verifyCode(code: String): VerifyCodeResult {
        verified += code
        val result = nextVerify ?: if (code == validCode) VerifyCodeResult.SignedIn(uid) else VerifyCodeResult.Wrong
        nextVerify = null
        if (result is VerifyCodeResult.SignedIn) user.value = result.userId
        return result
    }

    override suspend fun signOut() {
        signOuts++
        user.value = null
    }
}
