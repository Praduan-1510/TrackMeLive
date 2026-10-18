package live.trackme.spike.calldetect

import android.media.AudioAttributes
import android.media.AudioManager
import android.telephony.TelephonyManager

/**
 * How the spike reads an audio mode. MODE_IN_CALL, MODE_CALL_REDIRECT and
 * MODE_COMMUNICATION_REDIRECT can only be set by a holder of MODIFY_PHONE_STATE (Telecom and the
 * phone process), so a regular app can't fake them. MODE_CALL_SCREENING is set by Telecom while a
 * connected cellular call is with a screening app. Apps targeting API 31+ see modes 4-6 as they are
 * (no compat mapping), so all three count as a cellular call here.
 */
object AudioModes {
    // Literal values so the code compiles the same against every SDK (4 is API 30, 5-6 are API 33).
    const val MODE_CALL_SCREENING = 4
    const val MODE_CALL_REDIRECT = 5
    const val MODE_COMMUNICATION_REDIRECT = 6

    fun name(mode: Int): String = when (mode) {
        AudioManager.MODE_INVALID -> "INVALID"
        AudioManager.MODE_CURRENT -> "CURRENT"
        AudioManager.MODE_NORMAL -> "NORMAL"
        AudioManager.MODE_RINGTONE -> "RINGTONE"
        AudioManager.MODE_IN_CALL -> "IN_CALL"
        AudioManager.MODE_IN_COMMUNICATION -> "IN_COMMUNICATION"
        MODE_CALL_SCREENING -> "CALL_SCREENING"
        MODE_CALL_REDIRECT -> "CALL_REDIRECT"
        MODE_COMMUNICATION_REDIRECT -> "COMMUNICATION_REDIRECT"
        else -> "UNKNOWN($mode)"
    }

    /** What the real app would conclude from this mode alone, without the Phone permission. */
    fun meaning(mode: Int): String = when (mode) {
        AudioManager.MODE_NORMAL -> "no call"
        AudioManager.MODE_RINGTONE -> "a call is ringing (not answered yet)"
        AudioManager.MODE_IN_CALL -> "cellular call (dialing, active or held)"
        AudioManager.MODE_IN_COMMUNICATION -> "VoIP or voice chat, not a cellular call"
        MODE_CALL_SCREENING -> "cellular call with a screening app"
        MODE_CALL_REDIRECT -> "cellular call, audio on another device"
        MODE_COMMUNICATION_REDIRECT -> "VoIP call, audio on another device"
        else -> "unknown"
    }

    fun isCellularCall(mode: Int): Boolean =
        mode == AudioManager.MODE_IN_CALL || mode == MODE_CALL_SCREENING || mode == MODE_CALL_REDIRECT

    fun isVoip(mode: Int): Boolean =
        mode == AudioManager.MODE_IN_COMMUNICATION || mode == MODE_COMMUNICATION_REDIRECT

    fun describe(mode: Int): String = "${name(mode)}($mode)"

    fun callStateName(state: Int): String = when (state) {
        TelephonyManager.CALL_STATE_IDLE -> "IDLE"
        TelephonyManager.CALL_STATE_RINGING -> "RINGING"
        TelephonyManager.CALL_STATE_OFFHOOK -> "OFFHOOK"
        else -> "UNKNOWN($state)"
    }

    fun usageName(usage: Int): String = when (usage) {
        AudioAttributes.USAGE_UNKNOWN -> "UNKNOWN"
        AudioAttributes.USAGE_MEDIA -> "MEDIA"
        AudioAttributes.USAGE_VOICE_COMMUNICATION -> "VOICE_COMMUNICATION"
        AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING -> "VOICE_SIGNALLING"
        AudioAttributes.USAGE_ALARM -> "ALARM"
        AudioAttributes.USAGE_NOTIFICATION -> "NOTIFICATION"
        AudioAttributes.USAGE_NOTIFICATION_RINGTONE -> "RINGTONE"
        AudioAttributes.USAGE_NOTIFICATION_EVENT -> "NOTIFICATION_EVENT"
        AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY -> "ACCESSIBILITY"
        AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE -> "NAVIGATION"
        AudioAttributes.USAGE_ASSISTANCE_SONIFICATION -> "SONIFICATION"
        AudioAttributes.USAGE_GAME -> "GAME"
        AudioAttributes.USAGE_ASSISTANT -> "ASSISTANT"
        else -> "USAGE_$usage"
    }
}
