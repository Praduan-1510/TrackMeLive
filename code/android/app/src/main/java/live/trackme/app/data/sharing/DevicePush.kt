package live.trackme.app.data.sharing

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.messaging.FirebaseMessaging
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import live.trackme.schema.Device
import live.trackme.schema.DevicePlatform
import live.trackme.schema.TmlPaths

/** This phone's push token (FCM), or null when there isn't one yet. Never throws. */
fun interface PushTokens {
    suspend fun token(): String?
}

/**
 * FCM's token. On the emulators' demo project FCM can't issue one: that's "no token yet", logged, and
 * tried again on the next launch. Sharing never waits on it.
 */
class FcmPushTokens(private val messaging: () -> FirebaseMessaging = { FirebaseMessaging.getInstance() }) : PushTokens {
    override suspend fun token(): String? = try {
        messaging().token.await()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        // IOException (no FCM), IllegalStateException (no project), and whatever else the SDK throws.
        Log.w(TAG, "no push token yet: ${e.javaClass.simpleName}")
        null
    }
}

/** users/{uid}/devices/{deviceId} (FSD §6). Throws [SharingDataException]. */
interface DeviceRegistry {
    suspend fun write(userId: String, deviceId: String, pushToken: String)

    suspend fun delete(userId: String, deviceId: String)
}

/** [DeviceRegistry] on Firestore, writing exactly the four fields the rules allow (validDevice). */
class FirestoreDeviceRegistry(private val firestore: () -> FirebaseFirestore) : DeviceRegistry {
    override suspend fun write(userId: String, deviceId: String, pushToken: String) = call {
        firestore().document(TmlPaths.device(userId, deviceId)).set(deviceFields(pushToken)).await()
    }

    override suspend fun delete(userId: String, deviceId: String) = call {
        firestore().document(TmlPaths.device(userId, deviceId)).delete().await()
    }

    private suspend fun call(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: FirebaseFirestoreException) {
            throw SharingDataException(FirestoreSessionDataSource.firestoreFailureOf(e), e)
        }
    }

    companion object {
        /** The device doc: Android, the token, no Live Activity token, and the server's time. */
        fun deviceFields(pushToken: String): Map<String, Any?> = mapOf(
            Device.Fields.PLATFORM to DevicePlatform.ANDROID.wire,
            Device.Fields.PUSH_TOKEN to pushToken,
            Device.Fields.LIVE_ACTIVITY_START_TOKEN to null,
            Device.Fields.UPDATED_AT to FieldValue.serverTimestamp(),
        )
    }
}

/** A UUID made once per install and kept with the app's data. */
class InstallId(private val prefs: SharedPreferences) {
    constructor(context: Context) : this(context.getSharedPreferences(FILE, Context.MODE_PRIVATE))

    @Synchronized
    fun get(): String = prefs.getString(KEY, null) ?: UUID.randomUUID().toString().also { prefs.edit(commit = true) { putString(KEY, it) } }

    private companion object {
        const val FILE = "tml_install"
        const val KEY = "device_id"
    }
}

/**
 * Keeps this phone's device doc current, so the link-opened alert can reach it (Backend-Alerts):
 * written once signed in with a profile, on every launch, again whenever FCM issues a new token, and
 * right after each share starts if it hasn't been yet. Deleted before a sign-out ([unregister]); Delete
 * account removes it on the server. Every failure is logged and left for the next try: nothing here
 * ever blocks or fails a share.
 */
class DefaultPushRegistration(
    /** Who is signed in, observed over time: each account that signs in with a profile is registered. */
    private val userId: StateFlow<String?>,
    /** Who is signed in right now, settled (AuthRepository.currentUserId). */
    private val currentUserId: () -> String?,
    /** True while the signed-in person's profile exists (the rules allow the doc only then). */
    private val hasProfile: Flow<Boolean>,
    private val tokens: PushTokens,
    private val registry: DeviceRegistry,
    private val deviceId: () -> String,
    private val scope: CoroutineScope,
) : PushRegistration {
    private val writes = Mutex()

    /** The account whose doc this process has written, or null. */
    @Volatile
    private var registeredFor: String? = null

    /** Registers for each account that signs in with a profile, once per launch. Call once. */
    fun start() {
        scope.launch {
            combine(userId, hasProfile) { uid, has -> uid.takeIf { has } }
                .distinctUntilChanged()
                .collect { uid -> if (uid != null) register(uid, token = null) }
        }
    }

    override suspend fun ensureRegistered() {
        val uid = currentUserId() ?: return
        if (registeredFor != uid) register(uid, token = null)
    }

    /** FCM issued a new token (FirebaseMessagingService.onNewToken). */
    fun onNewToken(token: String) {
        val uid = currentUserId() ?: return
        scope.launch { register(uid, token) }
    }

    /** Deletes this phone's device doc; call before signing out. */
    suspend fun unregister() {
        val uid = currentUserId() ?: return
        writes.withLock {
            try {
                registry.delete(uid, deviceId())
            } catch (e: SharingDataException) {
                Log.w(TAG, "device doc delete failed: ${e.reason}")
            }
            registeredFor = null
        }
    }

    private suspend fun register(uid: String, token: String?) = writes.withLock {
        val pushToken = token ?: tokens.token() ?: return@withLock
        try {
            registry.write(uid, deviceId(), pushToken)
            registeredFor = uid
        } catch (e: SharingDataException) {
            Log.w(TAG, "device doc write failed: ${e.reason}")
        }
    }
}

private const val TAG = "TmlPush"
