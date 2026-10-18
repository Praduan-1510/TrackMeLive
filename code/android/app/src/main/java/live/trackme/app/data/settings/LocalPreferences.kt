package live.trackme.app.data.settings

import kotlinx.coroutines.flow.Flow

/**
 * How far this install has got through first-run setup. Stored on the phone, so a restart resumes where
 * the person left off; the sign-in itself is kept by Firebase Authentication.
 */
enum class SetupStage {
    /** The three onboarding pages haven't been finished or skipped. */
    Onboarding,

    /** Onboarded; signing up (or back in) with a name and number. */
    SignUp,

    /** A new account was just created: choose a mascot, then Home. */
    Mascot,

    /** Set up: the app opens on Home. */
    Done,
    ;

    /** The "onboarded" flag: true once onboarding was finished or skipped. */
    val onboarded: Boolean get() = this != Onboarding
}

/** Small values kept only on this phone (DataStore). Each flow emits the stored value, then every change. */
interface LocalPreferences {
    val setupStage: Flow<SetupStage>
    suspend fun setSetupStage(stage: SetupStage)

    val appearance: Flow<Appearance>
    suspend fun setAppearance(appearance: Appearance)

    /**
     * Forgets everything about the account (after it's deleted), as on a fresh install. Appearance
     * stays: it's a preference of this phone, not of the account.
     */
    suspend fun clearAccountData()
}
