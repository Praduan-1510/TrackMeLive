package live.trackme.app.data.settings

/**
 * Settings › Appearance (FSD §4 Settings): follow the system, or always light or dark. Kept on this
 * phone only, in DataStore; it isn't part of the synced profile settings.
 */
enum class Appearance {
    System,
    Light,
    Dark,
    ;

    /** Whether the app draws dark, given the system's current choice. */
    fun isDark(systemDark: Boolean): Boolean = when (this) {
        System -> systemDark
        Light -> false
        Dark -> true
    }
}
