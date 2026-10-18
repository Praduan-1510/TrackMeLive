package live.trackme.app.fakes

import kotlinx.coroutines.flow.MutableStateFlow
import live.trackme.app.data.settings.Appearance
import live.trackme.app.data.settings.LocalPreferences
import live.trackme.app.data.settings.SetupStage

class FakeLocalPreferences(
    stage: SetupStage = SetupStage.SignUp,
    appearance: Appearance = Appearance.System,
) : LocalPreferences {
    override val setupStage = MutableStateFlow(stage)
    override val appearance = MutableStateFlow(appearance)

    override suspend fun setSetupStage(stage: SetupStage) {
        setupStage.value = stage
    }

    override suspend fun setAppearance(appearance: Appearance) {
        this.appearance.value = appearance
    }

    override suspend fun clearAccountData() {
        setupStage.value = SetupStage.Onboarding
    }
}
