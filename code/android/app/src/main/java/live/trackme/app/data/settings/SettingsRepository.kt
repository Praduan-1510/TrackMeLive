package live.trackme.app.data.settings

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.schema.UserSettings

/**
 * Settings (FSD §4 Settings). Appearance stays on this phone; everything else is part of the profile
 * (users/{uid}.settings), so it follows the person to a new phone.
 */
interface SettingsRepository {
    val appearance: Flow<Appearance>
    suspend fun setAppearance(appearance: Appearance)

    /** The synced settings, or null until the profile has loaded. Shows a change as soon as its save starts. */
    val synced: Flow<UserSettings?>

    /** Saves [change] to the synced settings with the rest of the profile. */
    suspend fun updateSynced(change: (UserSettings) -> UserSettings): SaveProfileResult

    /** True while the profile can't be updated from the server (ProfileRepository.updatesUnavailable). */
    val updatesUnavailable: Flow<Boolean>
}

class DefaultSettingsRepository(
    private val local: LocalPreferences,
    private val profiles: ProfileRepository,
) : SettingsRepository {
    override val appearance: Flow<Appearance> = local.appearance

    override suspend fun setAppearance(appearance: Appearance) = local.setAppearance(appearance)

    override val synced: Flow<UserSettings?> =
        profiles.profile.map { (it as? ProfileState.Ready)?.profile?.settings }.distinctUntilChanged()

    override suspend fun updateSynced(change: (UserSettings) -> UserSettings): SaveProfileResult =
        profiles.update { it.copy(settings = change(it.settings)) }

    override val updatesUnavailable: Flow<Boolean> = profiles.updatesUnavailable
}
