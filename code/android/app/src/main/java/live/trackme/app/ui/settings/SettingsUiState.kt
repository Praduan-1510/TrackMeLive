package live.trackme.app.ui.settings

import androidx.compose.runtime.Immutable
import live.trackme.app.data.settings.Appearance
import live.trackme.schema.DefaultStop
import live.trackme.schema.Precision

/**
 * Everything Settings shows (prototype › viewSettings). The synced settings mirror
 * `users.settings` (FSD §4 Settings, `UserSettings` in the schema) with the same defaults;
 * [appearance] is kept on this phone only.
 */
@Immutable
data class SettingsUiState(
    val offerOnCall: Boolean = true,
    val precision: Precision = Precision.PRECISE,
    val defaultStop: DefaultStop = DefaultStop.CALL,
    val shareBack: Boolean = true,
    val alertLinkOpened: Boolean = true,
    val alertCallEnded: Boolean = true,
    val alertExpiry: Boolean = true,
    val appearance: Appearance = Appearance.System,
    val permissions: PermissionsUiState = PermissionsUiState(),
    /** The profile can't be updated right now: a quiet note at the top until a snapshot gets through. */
    val updatesUnavailable: Boolean = false,
    /** Delete account is running: its row shows progress and can't be tapped, and the confirm is off. */
    val deleting: Boolean = false,
)

/** Where one runtime permission stands, as Settings words it. */
enum class PermissionStatus {
    /** Never asked: "Not set". */
    NotAsked,

    /** Granted. */
    Allowed,

    /** Refused, or turned off in system Settings. */
    Denied,
}

/**
 * The Permissions rows. They only show state for now; the rows that open the system pages come with
 * the permission flows.
 */
@Immutable
data class PermissionsUiState(
    val location: PermissionStatus = PermissionStatus.NotAsked,
    /** False when only approximate location is granted. */
    val preciseLocation: Boolean = true,
    val phone: PermissionStatus = PermissionStatus.NotAsked,
    val notifications: PermissionStatus = PermissionStatus.NotAsked,
)

/** What the person did on Settings. The owner of the state persists it and sends back a new state. */
sealed interface SettingsEvent {
    data class OfferOnCallChanged(val on: Boolean) : SettingsEvent

    data class PrecisionChanged(val precision: Precision) : SettingsEvent

    data class DefaultStopChanged(val stop: DefaultStop) : SettingsEvent

    data class ShareBackChanged(val on: Boolean) : SettingsEvent

    data class AlertLinkOpenedChanged(val on: Boolean) : SettingsEvent

    data class AlertCallEndedChanged(val on: Boolean) : SettingsEvent

    data class AlertExpiryChanged(val on: Boolean) : SettingsEvent

    data class AppearanceChanged(val appearance: Appearance) : SettingsEvent

    /** Sent only after the person confirmed in the Delete your account? dialog. */
    data object DeleteAccountConfirmed : SettingsEvent
}
