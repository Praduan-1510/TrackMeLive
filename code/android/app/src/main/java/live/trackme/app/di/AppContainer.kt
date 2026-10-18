package live.trackme.app.di

import android.app.Activity
import android.content.Context
import android.telephony.TelephonyManager
import androidx.datastore.preferences.preferencesDataStore
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import live.trackme.app.TrackMeLiveApplication
import live.trackme.app.data.auth.AccountRepository
import live.trackme.app.data.auth.AccountSession
import live.trackme.app.data.auth.AuthRepository
import live.trackme.app.data.auth.DefaultAccountRepository
import live.trackme.app.data.auth.deleteAccount
import live.trackme.app.data.auth.FirebaseAuthRepository
import live.trackme.app.data.firebase.FirebaseEnvironment
import live.trackme.app.data.firebase.FirebaseServices
import live.trackme.app.data.profile.DefaultProfileRepository
import live.trackme.app.data.profile.FirestoreProfileDataSource
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.settings.DataStoreLocalPreferences
import live.trackme.app.data.settings.DefaultSettingsRepository
import live.trackme.app.data.settings.LocalPreferences
import live.trackme.app.data.settings.SettingsRepository
import live.trackme.app.domain.Clock
import live.trackme.app.domain.PhoneNumbers
import live.trackme.app.domain.SystemClock

/**
 * Everything the screens depend on, built once per process (manual DI: the graph is small). View
 * models get these through their factories, and tests build view models with fakes instead.
 */
interface AppContainer {
    val auth: AuthRepository
    val account: AccountRepository
    val session: AccountSession
    val profiles: ProfileRepository
    val settings: SettingsRepository
    val preferences: LocalPreferences
    val phoneNumbers: PhoneNumbers
    val clock: Clock

    /** The country the phone's SIM, network or locale suggests, as an ISO 3166 region code. */
    fun defaultRegion(): String
}

/**
 * The app's container, from any Context. View model factories take it as a parameter rather than
 * reading CreationExtras' APPLICATION_KEY: Navigation 3's per-screen view model owners don't supply
 * that key.
 */
val Context.appContainer: AppContainer get() = (applicationContext as TrackMeLiveApplication).container

private val Context.preferencesStore by preferencesDataStore(name = "trackmelive")

class DefaultAppContainer(
    private val context: Context,
    environment: FirebaseEnvironment = FirebaseEnvironment.forBuild(),
    currentActivity: () -> Activity?,
) : AppContainer {
    /** Outlives every screen: listeners and in-flight saves keep going across configuration changes. */
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val firebase by lazy { FirebaseServices(context, environment) }

    override val auth: AuthRepository by lazy { FirebaseAuthRepository(firebase.auth, appScope, currentActivity) }

    override val session: AccountSession by lazy {
        AccountSession(auth, preferences, profiles = { profiles }, clearLocalCache = { firebase.clearFirestoreCache() })
    }

    override val account: AccountRepository by lazy {
        DefaultAccountRepository(deleteOnServer = { firebase.functions.deleteAccount() }, session = session, profiles = profiles)
    }

    override val profiles: ProfileRepository by lazy {
        DefaultProfileRepository(
            userId = auth.userId,
            source = FirestoreProfileDataSource({ firebase.firestore }, firebase.functions),
            scope = appScope,
            onSignInEnded = { session.signInEnded() },
        )
    }

    override val preferences: LocalPreferences by lazy { DataStoreLocalPreferences(context.preferencesStore) }

    override val settings: SettingsRepository by lazy { DefaultSettingsRepository(preferences, profiles) }

    override val phoneNumbers: PhoneNumbers by lazy { PhoneNumbers() }

    override val clock: Clock = SystemClock

    override fun defaultRegion(): String {
        val telephony = context.getSystemService(TelephonyManager::class.java)
        return PhoneNumbers.pickRegion(
            telephony?.simCountryIso,
            telephony?.networkCountryIso,
            Locale.getDefault().country,
        )
    }
}
