package live.trackme.app.data.settings

import androidx.datastore.core.DataStore
import androidx.datastore.core.IOException
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** [LocalPreferences] in a Preferences DataStore. Values are stored by enum name. */
class DataStoreLocalPreferences(private val store: DataStore<Preferences>) : LocalPreferences {

    // A read error (a corrupt file) falls back to the defaults rather than crashing the app.
    private val prefs: Flow<Preferences> = store.data.catch { e ->
        if (e is IOException) emit(emptyPreferences()) else throw e
    }

    override val setupStage: Flow<SetupStage> =
        prefs.map { it[SETUP_STAGE].toEnum(SetupStage.Onboarding) }.distinctUntilChanged()

    override suspend fun setSetupStage(stage: SetupStage) {
        store.edit { it[SETUP_STAGE] = stage.name }
    }

    override val appearance: Flow<Appearance> =
        prefs.map { it[APPEARANCE].toEnum(Appearance.System) }.distinctUntilChanged()

    override suspend fun setAppearance(appearance: Appearance) {
        store.edit { it[APPEARANCE] = appearance.name }
    }

    override suspend fun clearAccountData() {
        store.edit { prefs ->
            val appearance = prefs[APPEARANCE]
            prefs.clear()
            if (appearance != null) prefs[APPEARANCE] = appearance
        }
    }

    private companion object {
        val SETUP_STAGE = stringPreferencesKey("setup_stage")
        val APPEARANCE = stringPreferencesKey("appearance")

        inline fun <reified E : Enum<E>> String?.toEnum(default: E): E =
            enumValues<E>().firstOrNull { it.name == this } ?: default
    }
}
