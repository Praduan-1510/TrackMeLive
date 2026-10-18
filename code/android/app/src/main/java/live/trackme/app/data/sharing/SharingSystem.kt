package live.trackme.app.data.sharing

import android.content.Context
import android.os.BatteryManager
import live.trackme.app.domain.BatteryReading

/** The battery level, read when the cadence is worked out (FSD §7). */
fun interface BatteryMonitor {
    fun reading(): BatteryReading
}

/** BatteryManager's capacity: no receiver and no permission. */
class SystemBatteryMonitor(context: Context) : BatteryMonitor {
    private val manager = context.getSystemService(BatteryManager::class.java)

    override fun reading(): BatteryReading {
        val percent = manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        // The property reads Integer.MIN_VALUE (or 0 on some emulators without a battery) when unknown.
        return BatteryReading(percent?.takeIf { it in 1..100 })
    }
}

/** Starts and stops the location foreground service that keeps a share running in the background. */
interface SharingServiceController {
    /** The service is up (created and not yet destroyed). */
    val isRunning: Boolean

    /**
     * Starts it. Throws [ForegroundStartRefused] when Android won't start a foreground service now (the
     * app isn't in the foreground, Android 12+).
     */
    fun start()

    fun stop()
}

class ForegroundStartRefused(cause: Throwable? = null) : Exception("Foreground service start refused", cause)
