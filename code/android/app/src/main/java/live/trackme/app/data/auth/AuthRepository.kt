package live.trackme.app.data.auth

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * Phone-number sign-in (FSD §4 Sign up, §8 Phone number): a 6-digit code sent by text confirms the
 * number. Firebase Authentication alone holds the number, in E.164; the app never stores it.
 */
interface AuthRepository {
    /**
     * The signed-in user's id, or null when signed out, for observing over time. Survives app restarts.
     * Code that runs right after a sign-in or sign-out reads [currentUserId] instead.
     */
    val userId: StateFlow<String?>

    /**
     * Who is signed in right now, settled: it changes the moment [verifyCode], [sendCode] (signed in on
     * the spot) or [signOut] completes (FirebaseAuth.currentUser). Read this, never [userId]'s value, in
     * code that runs right after one of them, such as the profile fetch after a code is verified.
     */
    fun currentUserId(): String?

    /**
     * Codes the phone read from the incoming text by itself (Android's SMS retrieval), so the code
     * field can fill in without typing. Emits only while a code is pending.
     */
    val retrievedCodes: Flow<String>

    /**
     * Texts a code to [e164]. With [resend], asks for a new code for the same number (Send a new code).
     * Some phones verify the number on the spot, with no code to type: that returns [SendCodeResult.SignedIn].
     */
    suspend fun sendCode(e164: String, resend: Boolean = false): SendCodeResult

    /** Checks [code] against the last code sent and signs in when it matches. */
    suspend fun verifyCode(code: String): VerifyCodeResult

    /** Signs out of this phone. The profile stays on the server. */
    suspend fun signOut()
}

sealed interface SendCodeResult {
    /** The text is on its way. */
    data object CodeSent : SendCodeResult

    /** The phone verified the number without a code, and the person is signed in. */
    data class SignedIn(val userId: String) : SendCodeResult

    data class Failed(val reason: SendFailure) : SendCodeResult
}

enum class SendFailure {
    /** Firebase rejected the number: it isn't a valid mobile number. */
    InvalidNumber,

    /** Too many codes for this number or phone; wait before asking again. */
    TooManyRequests,

    /** No connection, or the request timed out. */
    Network,

    /** Anything else. Shown like a network failure: try again. */
    Other,
}

sealed interface VerifyCodeResult {
    data class SignedIn(val userId: String) : VerifyCodeResult

    /** The code doesn't match the one sent. */
    data object Wrong : VerifyCodeResult

    /** The code (or the verification it belongs to) expired: a new one is needed. */
    data object Expired : VerifyCodeResult

    data class Failed(val reason: VerifyFailure) : VerifyCodeResult
}

enum class VerifyFailure {
    Network,
    TooManyRequests,
    Other,
}
