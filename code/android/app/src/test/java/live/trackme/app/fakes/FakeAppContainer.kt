package live.trackme.app.fakes

import java.time.LocalTime
import kotlinx.coroutines.CoroutineScope
import live.trackme.app.data.auth.AccountRepository
import live.trackme.app.data.auth.AccountSession
import live.trackme.app.data.auth.DefaultAccountRepository
import live.trackme.app.data.auth.DeleteAccountResult
import live.trackme.app.data.profile.DefaultProfileRepository
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.settings.DefaultSettingsRepository
import live.trackme.app.data.settings.SettingsRepository
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.di.AppContainer
import live.trackme.app.domain.Clock
import live.trackme.app.domain.PhoneNumbers

/** The whole app on fakes: phone sign-in, users/{uid} and DataStore in memory, and still time. */
class FakeAppContainer(
    scope: CoroutineScope,
    override val auth: FakeAuthRepository = FakeAuthRepository(),
    val profileSource: FakeProfileDataSource = FakeProfileDataSource(),
    override val preferences: FakeLocalPreferences = FakeLocalPreferences(SetupStage.Onboarding),
    override val sharing: FakeSharingRepository = FakeSharingRepository(),
    override val locationPermissions: FakeLocationPermissions = FakeLocationPermissions(),
) : AppContainer {
    override val profiles: ProfileRepository = DefaultProfileRepository(auth.userId, auth::currentUserId, profileSource, scope)
    override val settings: SettingsRepository = DefaultSettingsRepository(preferences, profiles)
    override val phoneNumbers = PhoneNumbers()
    override val clock: Clock = object : Clock {
        override fun elapsedMillis(): Long = 0
        override fun localTime(): LocalTime = LocalTime.of(20, 0)
    }
    override val session = AccountSession(auth, preferences, profiles = { profiles }, clearLocalCache = {})
    override val account: AccountRepository = DefaultAccountRepository({ DeleteAccountResult.Deleted }, session, profiles)

    override fun defaultRegion(): String = "US"
}
