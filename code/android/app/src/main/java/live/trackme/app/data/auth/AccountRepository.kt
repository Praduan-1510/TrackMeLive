package live.trackme.app.data.auth

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.schema.DeleteAccountRequest
import live.trackme.schema.TmlCallables

/** Settings › Delete account and all data (FSD §4 Settings, §8 Deletion). */
interface AccountRepository {
    /**
     * Deletes the account and everything in it on the server, then forgets it on this phone
     * ([AccountSession.accountDeleted]), so the app starts again at onboarding with nothing of the
     * account left. Safe to call again after a failure; the server finishes what's left. One at a
     * time: while a delete runs, another call returns [DeleteAccountResult.InProgress] at once.
     */
    suspend fun deleteAccount(): DeleteAccountResult

    /** True while a delete runs. Profile saves are refused meanwhile. */
    val deleting: StateFlow<Boolean>
}

enum class DeleteAccountResult {
    Deleted,
    Network,
    Failed,

    /** The server says the sign-in has ended (unauthenticated): treated as signed out. */
    SignInEnded,

    /** A delete was already running; this call did nothing. */
    InProgress,
}

/**
 * [AccountRepository]: [deleteOnServer] (the deleteAccount callable in the app), then [session] forgets
 * the account on this phone. A sign-in the server says has ended is handled the same way, as signed out.
 */
class DefaultAccountRepository(
    private val deleteOnServer: suspend () -> DeleteAccountResult,
    private val session: AccountSession,
    private val profiles: ProfileRepository,
) : AccountRepository {
    private val running = MutableStateFlow(false)
    override val deleting: StateFlow<Boolean> = running.asStateFlow()

    override suspend fun deleteAccount(): DeleteAccountResult {
        // Single flight: a second confirm while the first runs does nothing.
        if (!running.compareAndSet(expect = false, update = true)) return DeleteAccountResult.InProgress
        try {
            // Saves are shut for the whole delete, so no saveProfile can recreate users/{uid}.
            return profiles.withSavesBlocked {
                val result = deleteOnServer()
                when (result) {
                    DeleteAccountResult.Deleted -> session.accountDeleted()
                    DeleteAccountResult.SignInEnded -> session.signInEnded()
                    else -> Unit
                }
                result
            }
        } finally {
            running.value = false
        }
    }
}

/** The deleteAccount callable (Backend A): no fields; idempotent, so a failed run can simply be repeated. */
suspend fun FirebaseFunctions.deleteAccount(): DeleteAccountResult = try {
    getHttpsCallable(TmlCallables.DELETE_ACCOUNT).call(DeleteAccountRequest.toMap()).await()
    DeleteAccountResult.Deleted
} catch (e: CancellationException) {
    throw e
} catch (_: FirebaseNetworkException) {
    DeleteAccountResult.Network
} catch (e: FirebaseFunctionsException) {
    val offline = e.code == FirebaseFunctionsException.Code.UNAVAILABLE ||
        e.code == FirebaseFunctionsException.Code.DEADLINE_EXCEEDED ||
        (e.code == FirebaseFunctionsException.Code.INTERNAL && e.cause is IOException)
    when {
        e.code == FirebaseFunctionsException.Code.UNAUTHENTICATED -> DeleteAccountResult.SignInEnded
        offline -> DeleteAccountResult.Network
        else -> DeleteAccountResult.Failed
    }
}
