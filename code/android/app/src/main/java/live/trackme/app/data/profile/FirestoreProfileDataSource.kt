package live.trackme.app.data.profile

import android.util.Log
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import live.trackme.schema.SaveProfileRequest
import live.trackme.schema.SaveProfileResponse
import live.trackme.schema.TmlCallables
import live.trackme.schema.TmlPaths
import live.trackme.schema.User

/**
 * [ProfileDataSource] on Firestore (reads of users/{uid}) and the saveProfile callable (every write).
 * [firestore] gives the current instance: deleting an account replaces it (FirebaseServices.clearFirestoreCache).
 */
class FirestoreProfileDataSource(
    private val firestore: () -> FirebaseFirestore,
    private val functions: FirebaseFunctions,
) : ProfileDataSource {

    override fun observe(uid: String): Flow<RemoteProfile> = callbackFlow {
        val registration = firestore().document(TmlPaths.user(uid)).addSnapshotListener { snapshot, error ->
            when {
                // An error ends the listener; the repository retries with backoff (or signs out when the
                // sign-in has ended).
                error != null -> {
                    Log.w(TAG, "users/{uid} listener stopped: ${error.code}")
                    trySend(RemoteProfile.Failed(firestoreFailureOf(error)))
                    close()
                }
                snapshot == null -> Unit
                snapshot.exists() -> trySend(snapshot.toProfileOrNull()?.let { RemoteProfile.Present(it) } ?: RemoteProfile.Loading)
                // Not in the cache tells nothing yet: wait for the server's answer before saying "missing".
                snapshot.metadata.isFromCache -> trySend(RemoteProfile.Loading)
                else -> trySend(RemoteProfile.Missing)
            }
        }
        awaitClose {
            // A listener on an instance that was terminated (after Delete account) is already gone.
            try {
                registration.remove()
            } catch (_: IllegalStateException) {
            }
        }
    }.distinctUntilChanged()

    override suspend fun fetch(uid: String): Profile? = try {
        // A server read waits for the connection; after a dropped network that can take minutes, so give
        // up sooner and let the person try again.
        val snapshot = withTimeoutOrNull(FETCH_TIMEOUT_MS) { firestore().document(TmlPaths.user(uid)).get(Source.SERVER).await() }
            ?: run {
                Log.w(TAG, "users/{uid} read timed out")
                throw ProfileDataException(ProfileFailure.Network)
            }
        if (snapshot.exists()) snapshot.toProfile() else null
    } catch (e: CancellationException) {
        throw e
    } catch (e: FirebaseFirestoreException) {
        Log.w(TAG, "users/{uid} read failed: ${e.code}", e)
        throw ProfileDataException(firestoreFailureOf(e), e)
    }

    override suspend fun save(profile: Profile, includeSettings: Boolean): Profile {
        val request = SaveProfileRequest(
            name = profile.name,
            mascotId = profile.mascotId,
            mascotColor = profile.mascotColor,
            mascotAccessory = profile.mascotAccessory,
            settings = if (includeSettings) profile.settings else null,
        )
        val data = try {
            functions.getHttpsCallable(TmlCallables.SAVE_PROFILE)
                .apply { setTimeout(CALL_TIMEOUT_S, TimeUnit.SECONDS) }
                .call(request.toMap()).await().getData()
        } catch (e: CancellationException) {
            throw e
        } catch (e: FirebaseFunctionsException) {
            Log.w(TAG, "saveProfile failed: ${e.code} ${rejectedFields(e.details)}", e)
            throw ProfileDataException(functionsFailureOf(e), e)
        } catch (e: FirebaseNetworkException) {
            Log.w(TAG, "saveProfile failed: no connection", e)
            throw ProfileDataException(ProfileFailure.Network, e)
        }
        val response = try {
            SaveProfileResponse.fromMap(data as? Map<*, *> ?: emptyMap<String, Any?>())
        } catch (e: IllegalArgumentException) {
            throw ProfileDataException(ProfileFailure.Other, e)
        }
        return response.toProfile()
    }

    internal companion object {
        const val FETCH_TIMEOUT_MS = 15_000L
        const val CALL_TIMEOUT_S = 20L

        fun functionsFailureOf(e: FirebaseFunctionsException): ProfileFailure = when (e.code) {
            FirebaseFunctionsException.Code.UNAUTHENTICATED -> ProfileFailure.SignInEnded
            FirebaseFunctionsException.Code.PERMISSION_DENIED -> ProfileFailure.NotSignedIn
            FirebaseFunctionsException.Code.INVALID_ARGUMENT -> if (rejectedFields(e.details).contains("name")) ProfileFailure.InvalidName else ProfileFailure.Invalid
            FirebaseFunctionsException.Code.UNAVAILABLE, FirebaseFunctionsException.Code.DEADLINE_EXCEEDED -> ProfileFailure.Network
            // The SDK reports a dropped connection as INTERNAL caused by an IOException.
            FirebaseFunctionsException.Code.INTERNAL -> if (e.cause is IOException) ProfileFailure.Network else ProfileFailure.Other
            else -> ProfileFailure.Other
        }

        fun firestoreFailureOf(e: FirebaseFirestoreException): ProfileFailure = when (e.code) {
            FirebaseFirestoreException.Code.UNAVAILABLE, FirebaseFirestoreException.Code.DEADLINE_EXCEEDED -> ProfileFailure.Network
            FirebaseFirestoreException.Code.UNAUTHENTICATED -> ProfileFailure.SignInEnded
            FirebaseFirestoreException.Code.PERMISSION_DENIED -> ProfileFailure.NotSignedIn
            else -> ProfileFailure.Other
        }

        /** The `field` of each entry in invalid-argument details: `{errors: [{field, message}]}`. */
        fun rejectedFields(details: Any?): Set<String> =
            ((details as? Map<*, *>)?.get("errors") as? List<*>).orEmpty()
                .mapNotNull { (it as? Map<*, *>)?.get("field") as? String }
                .toSet()
    }
}

/** A document the schema can't read (it never should happen) reads as "not known yet", never as "no profile". */
private fun DocumentSnapshot.toProfileOrNull(): Profile? = try {
    toProfile()
} catch (e: RuntimeException) {
    Log.w(TAG, "users/{uid} doesn't match the schema", e)
    null
}

private fun DocumentSnapshot.toProfile(): Profile {
    val user = toObject(User::class.java) ?: User()
    return Profile(
        name = user.name,
        mascotId = user.mascotId,
        mascotColor = user.mascotColor,
        mascotAccessory = user.mascotAccessory,
        settings = user.settings,
        lastViewerName = user.lastViewerName,
        activeSessionId = user.activeSessionId,
        updatedAtMillis = user.updatedAt.toDate().time,
    )
}

private const val TAG = "TmlProfile"

private fun SaveProfileResponse.toProfile() = Profile(
    name = name,
    mascotId = mascotId,
    mascotColor = mascotColor,
    mascotAccessory = mascotAccessory,
    settings = settings,
    lastViewerName = lastViewerName,
    activeSessionId = activeSessionId,
    updatedAtMillis = updatedAt,
)
