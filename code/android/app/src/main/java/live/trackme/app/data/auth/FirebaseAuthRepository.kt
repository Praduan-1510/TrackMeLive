package live.trackme.app.data.auth

import android.app.Activity
import android.util.Log
import com.google.firebase.FirebaseException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthOptions
import com.google.firebase.auth.PhoneAuthProvider
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * [AuthRepository] on Firebase phone authentication. [currentActivity] gives Firebase an Activity
 * for its reCAPTCHA fallback on real projects; the emulators don't need one.
 */
class FirebaseAuthRepository(
    private val auth: FirebaseAuth,
    private val scope: CoroutineScope,
    private val currentActivity: () -> Activity?,
) : AuthRepository {

    // Settled at each transition, not only when Firebase's listener gets round to it: signIn and signOut
    // set it as soon as FirebaseAuth.currentUser has changed (synchronously, once signInWithCredential
    // completes), so nothing that runs right after them sees the old value. The listener (posted to the
    // main thread, so it can trail) covers changes made elsewhere, such as a revoked sign-in, and always
    // reads currentUser itself, so a late event never brings back a stale value.
    private val user = MutableStateFlow(auth.currentUser?.uid)
    override val userId: StateFlow<String?> = user.asStateFlow()

    init {
        auth.addAuthStateListener { user.value = it.currentUser?.uid }
    }

    override fun currentUserId(): String? = auth.currentUser?.uid

    private val retrieved = MutableSharedFlow<String>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val retrievedCodes: Flow<String> = retrieved.asSharedFlow()

    // The verification in progress. Firebase hands these back in onCodeSent; a resend reuses the token.
    @Volatile private var verificationId: String? = null
    @Volatile private var resendToken: PhoneAuthProvider.ForceResendingToken? = null

    override suspend fun sendCode(e164: String, resend: Boolean): SendCodeResult {
        // Firebase answers within seconds; past this, treat it like a dropped connection.
        return withTimeoutOrNull(SEND_TIMEOUT_MS) { requestCode(e164, resend) }
            ?: SendCodeResult.Failed(SendFailure.Network)
    }

    private suspend fun requestCode(e164: String, resend: Boolean): SendCodeResult =
        suspendCancellableCoroutine { cont ->
            val callbacks = object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) {
                    verificationId = id
                    resendToken = token
                    if (cont.isActive) cont.resume(SendCodeResult.CodeSent)
                }

                override fun onVerificationCompleted(credential: PhoneAuthCredential) {
                    if (cont.isActive) {
                        // Instant verification: no code to type. Sign in with the credential right away.
                        scope.launch {
                            val result = when (val signedIn = signIn(credential)) {
                                is VerifyCodeResult.SignedIn -> SendCodeResult.SignedIn(signedIn.userId)
                                else -> SendCodeResult.Failed(SendFailure.Other)
                            }
                            if (cont.isActive) cont.resume(result)
                        }
                    } else {
                        // The phone read the text by itself: hand the code to the code field.
                        credential.smsCode?.let { retrieved.tryEmit(it) }
                    }
                }

                override fun onVerificationFailed(e: FirebaseException) {
                    Log.w(TAG, "sending the code failed: ${(e as? FirebaseAuthException)?.errorCode ?: e.javaClass.simpleName}", e)
                    if (cont.isActive) cont.resume(SendCodeResult.Failed(sendFailureOf(e)))
                }
            }
            val options = PhoneAuthOptions.newBuilder(auth)
                .setPhoneNumber(e164)
                .setTimeout(AUTO_RETRIEVAL_TIMEOUT_S, TimeUnit.SECONDS)
                .setCallbacks(callbacks)
                .apply { currentActivity()?.let { setActivity(it) } }
                .apply { if (resend) resendToken?.let { setForceResendingToken(it) } }
                .build()
            PhoneAuthProvider.verifyPhoneNumber(options)
        }

    override suspend fun verifyCode(code: String): VerifyCodeResult {
        val id = verificationId ?: return VerifyCodeResult.Expired
        return signIn(PhoneAuthProvider.getCredential(id, code))
    }

    private suspend fun signIn(credential: PhoneAuthCredential): VerifyCodeResult = try {
        val signedIn = auth.signInWithCredential(credential).await().user
        if (signedIn != null) {
            verificationId = null
            resendToken = null
            user.value = signedIn.uid
            VerifyCodeResult.SignedIn(signedIn.uid)
        } else {
            VerifyCodeResult.Failed(VerifyFailure.Other)
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "checking the code failed: ${(e as? FirebaseAuthException)?.errorCode ?: e.javaClass.simpleName}", e)
        verifyResultOf(e)
    }

    override suspend fun signOut() {
        verificationId = null
        resendToken = null
        auth.signOut()
        user.value = null
    }

    internal companion object {
        private const val TAG = "TmlAuth"
        const val SEND_TIMEOUT_MS = 45_000L
        const val AUTO_RETRIEVAL_TIMEOUT_S = 60L

        fun sendFailureOf(e: Exception): SendFailure = when {
            e is FirebaseTooManyRequestsException -> SendFailure.TooManyRequests
            e is FirebaseNetworkException -> SendFailure.Network
            e is FirebaseAuthException && e.errorCode in INVALID_NUMBER_CODES -> SendFailure.InvalidNumber
            e is FirebaseAuthException && e.errorCode == "ERROR_QUOTA_EXCEEDED" -> SendFailure.TooManyRequests
            else -> SendFailure.Other
        }

        fun verifyResultOf(e: Exception): VerifyCodeResult = when {
            e is FirebaseTooManyRequestsException -> VerifyCodeResult.Failed(VerifyFailure.TooManyRequests)
            e is FirebaseNetworkException -> VerifyCodeResult.Failed(VerifyFailure.Network)
            e is FirebaseAuthException && e.errorCode == "ERROR_INVALID_VERIFICATION_CODE" -> VerifyCodeResult.Wrong
            e is FirebaseAuthException && e.errorCode in EXPIRED_CODES -> VerifyCodeResult.Expired
            else -> VerifyCodeResult.Failed(VerifyFailure.Other)
        }

        private val INVALID_NUMBER_CODES = setOf("ERROR_INVALID_PHONE_NUMBER", "ERROR_MISSING_PHONE_NUMBER")
        private val EXPIRED_CODES = setOf("ERROR_SESSION_EXPIRED", "ERROR_INVALID_VERIFICATION_ID", "ERROR_CODE_EXPIRED")
    }
}
