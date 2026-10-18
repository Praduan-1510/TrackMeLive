package live.trackme.spike.calldetect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager

/**
 * Manifest receiver for ACTION_PHONE_STATE_CHANGED. The system only delivers it to holders of
 * READ_PHONE_STATE, but it's on the implicit-broadcast exception list and is sent with
 * FLAG_RECEIVER_INCLUDE_BACKGROUND, so it starts the process when the app isn't running. The spike
 * logs it to see whether "the app can't know about calls while it isn't running" holds on Android.
 */
class PhoneStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        CallMonitor.start(context)
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: "?"
        SpikeLog.log("RECEIVER", "${intent.action} state=$state (manifest receiver)")
    }
}
