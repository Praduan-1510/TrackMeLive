package live.trackme.app.di

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import com.google.firebase.messaging.FirebaseMessaging
import android.telephony.TelephonyManager
import androidx.datastore.preferences.preferencesDataStore
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.map
import live.trackme.app.TrackMeLiveApplication
import live.trackme.app.data.auth.AccountRepository
import live.trackme.app.data.auth.AccountSession
import live.trackme.app.data.auth.AuthRepository
import live.trackme.app.data.auth.DefaultAccountRepository
import live.trackme.app.data.auth.deleteAccount
import live.trackme.app.data.auth.FirebaseAuthRepository
import live.trackme.app.data.firebase.FirebaseEnvironment
import live.trackme.app.data.firebase.FirebaseServices
import live.trackme.app.data.location.AndroidLocationPermissions
import live.trackme.app.data.location.FusedLocationUpdates
import live.trackme.app.data.location.LocationPermissions
import live.trackme.app.data.profile.DefaultProfileRepository
import live.trackme.app.data.profile.FirestoreProfileDataSource
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.settings.DataStoreLocalPreferences
import live.trackme.app.data.settings.DefaultSettingsRepository
import live.trackme.app.data.settings.LocalPreferences
import live.trackme.app.data.settings.SettingsRepository
import live.trackme.app.data.sharing.DefaultPingUploader
import live.trackme.app.data.sharing.DefaultSharingRepository
import live.trackme.app.data.sharing.FirestoreSessionDataSource
import live.trackme.app.data.sharing.PreferencesShareStore
import live.trackme.app.data.sharing.DefaultPushRegistration
import live.trackme.app.data.sharing.FcmPushTokens
import live.trackme.app.data.sharing.FirestoreDeviceRegistry
import live.trackme.app.data.sharing.InstallId
import live.trackme.app.data.sharing.SharingRepository
import live.trackme.app.data.sharing.SystemBatteryMonitor
import live.trackme.app.domain.Clock
import live.trackme.app.domain.PhoneNumbers
import live.trackme.app.domain.ServerClock
import live.trackme.app.domain.SystemClock
import live.trackme.app.service.AndroidSharingServiceController
import live.trackme.app.service.LinkOpenedAlert

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

    /** The share session: createSession, the live session, Stop, the link (data/sharing). */
    val sharing: SharingRepository

    /** Location and notification permissions (data/location). */
    val locationPermissions: LocationPermissions

    /** The country the phone's SIM, network or locale suggests, as an ISO 3166 region code. */
    fun defaultRegion(): String
}

/**
 * The app's container, from any Context. View model factories take it as a parameter rather than
 * reading CreationExtras' APPLICATION_KEY: Navigation 3's per-screen view model owners don't supply
 * that key.
 */
val Context.appContainer: AppContainer get() = (applicationContext as TrackMeLiveApplication).container

/** The device-doc registration, for FCM's onNewToken; null under a test container. */
val Context.pushRegistration: DefaultPushRegistration? get() = (appContainer as? DefaultAppContainer)?.pushRegistration

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
            currentUserId = auth::currentUserId,
            source = FirestoreProfileDataSource({ firebase.firestore }, firebase.functions),
            scope = appScope,
            onSignInEnded = { session.signInEnded() },
        )
    }

    override val preferences: LocalPreferences by lazy { DataStoreLocalPreferences(context.preferencesStore) }

    override val settings: SettingsRepository by lazy { DefaultSettingsRepository(preferences, profiles) }

    override val phoneNumbers: PhoneNumbers by lazy { PhoneNumbers() }

    override val clock: Clock = SystemClock

    private val serverClock by lazy { ServerClock(clock) }

    /** This phone's device doc for the alerts (Backend-Alerts): kept current from every launch. */
    val pushRegistration: DefaultPushRegistration by lazy {
        DefaultPushRegistration(
            userId = auth.userId,
            currentUserId = auth::currentUserId,
            hasProfile = profiles.profile.map { it is ProfileState.Ready },
            tokens = FcmPushTokens { firebase.app.get(FirebaseMessaging::class.java) },
            registry = FirestoreDeviceRegistry { firebase.firestore },
            deviceId = InstallId(context)::get,
            scope = appScope,
        )
    }

    init {
        // Every launch: the alert channel exists before an alert arrives, and the device doc is refreshed.
        LinkOpenedAlert.createChannel(context)
        pushRegistration.start()
    }

    override val locationPermissions: LocationPermissions by lazy { AndroidLocationPermissions(context, currentActivity) }

    override val sharing: SharingRepository by lazy {
        val store = PreferencesShareStore(context)
        val sessions = FirestoreSessionDataSource({ firebase.firestore }, firebase.functions)
        DefaultSharingRepository(
            userId = auth.userId,
            currentUserId = auth::currentUserId,
            source = sessions,
            uploader = DefaultPingUploader(
                location = FusedLocationUpdates(context),
                source = sessions,
                battery = SystemBatteryMonitor(context),
                serverClock = serverClock,
                clock = clock,
                onClockSynced = store::saveClockOffset,
            ),
            store = store,
            service = AndroidSharingServiceController(context),
            serverClock = serverClock,
            clock = clock,
            scope = appScope,
            hasLocationPermission = { FusedLocationUpdates.hasLocationPermission(context) },
            push = pushRegistration,
            onSignInEnded = { session.signInEnded() },
        ).also { repository ->
            // A share picked up after a restart gets its location service the next time the app is in front.
            (context.applicationContext as? Application)?.registerActivityLifecycleCallbacks(
                object : Application.ActivityLifecycleCallbacks {
                    override fun onActivityResumed(activity: Activity) = repository.onAppForeground()
                    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
                    override fun onActivityStarted(activity: Activity) = Unit
                    override fun onActivityPaused(activity: Activity) = Unit
                    override fun onActivityStopped(activity: Activity) = Unit
                    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
                    override fun onActivityDestroyed(activity: Activity) = Unit
                },
            )
        }
    }

    override fun defaultRegion(): String {
        val telephony = context.getSystemService(TelephonyManager::class.java)
        return PhoneNumbers.pickRegion(
            telephony?.simCountryIso,
            telephony?.networkCountryIso,
            Locale.getDefault().country,
        )
    }
}
