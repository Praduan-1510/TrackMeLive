package live.trackme.spike.calldetect

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioPlaybackConfiguration
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.concurrent.thread

/**
 * Process-wide watcher for every call signal an app can read, with and without READ_PHONE_STATE.
 * It lives as long as the process, so what it sees in the background depends only on the process
 * state (visible activity, foreground service, or cached/frozen), which is what the spike measures.
 *
 * Signals:
 *  - MODE_CB    AudioManager.OnModeChangedListener (API 31+, no permission)
 *  - MODE_POLL  AudioManager.getMode() every 500 ms (all versions, no permission)
 *  - TELEPHONY  TelephonyCallback.CallStateListener (API 31+, READ_PHONE_STATE) or
 *               PhoneStateListener LISTEN_CALL_STATE (API 29-30, no permission needed there)
 *  - PROBE      getCallState(), getCallStateForSubscription(), TelecomManager.isInCall() on each change
 *  - PLAYBACK   AudioManager.getActivePlaybackConfigurations() usages (no permission, anonymized)
 *  - DERIVED    what the app would decide: call start/end from the audio mode (with a 2 s end
 *               debounce) and from the telephony call state
 */
object CallMonitor {
    private const val POLL_MS = 500L
    private const val HEARTBEAT_MS = 5_000L
    private const val GAP_MS = 3_000L
    const val END_DEBOUNCE_MS = 2_000L

    private lateinit var app: Context
    private lateinit var audio: AudioManager
    private lateinit var telephony: TelephonyManager
    private lateinit var telecom: TelecomManager
    private val main = Handler(Looper.getMainLooper())
    private val changeListeners = CopyOnWriteArraySet<() -> Unit>()

    // Latest values, read by the UI.
    @Volatile var mode: Int = AudioManager.MODE_NORMAL
        private set
    @Volatile var phoneGranted = false
        private set
    @Volatile var telephonyRegistered = false
        private set
    @Volatile var telephonyState: Int? = null
        private set
    @Volatile var lastProbe: String = ""
        private set
    @Volatile var playbackUsages: String = "none"
        private set
    @Volatile var modeCallStart: Long? = null   // wall time, set while the audio mode says "call"
        private set
    @Volatile var telephonyCallStart: Long? = null
        private set
    @Volatile var voipSelfTestOn = false
        private set

    private var lastCallbackMode = Int.MIN_VALUE
    private var lastPolledMode = Int.MIN_VALUE
    private var pendingModeEnd: Runnable? = null
    private var lastTick = 0L
    private var lastHeartbeat = 0L
    private var modeListener: Any? = null
    private var telephonyCallback: Any? = null
    private var phoneStateListener: PhoneStateListener? = null
    private var voipTrack: AudioTrack? = null

    fun start(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        audio = app.getSystemService(AudioManager::class.java)
        telephony = app.getSystemService(TelephonyManager::class.java)
        telecom = app.getSystemService(TelecomManager::class.java)

        mode = audio.mode
        SpikeLog.log(
            "START",
            "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) ${Build.MANUFACTURER} ${Build.MODEL}; " +
                "mode=${AudioModes.describe(mode)}"
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) registerModeListener()
        audio.registerAudioPlaybackCallback(playbackCallback, main)
        updatePlayback(audio.activePlaybackConfigurations, "start")
        refreshPhonePermission(force = true)
        applyMode(mode, "start")
        main.post(pollTask)
    }

    fun addListener(listener: () -> Unit) { changeListeners.add(listener) }
    fun removeListener(listener: () -> Unit) { changeListeners.remove(listener) }
    private fun changed() = changeListeners.forEach { it() }

    // ---- Audio mode -------------------------------------------------------------------------

    private fun registerModeListener() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val listener = AudioManager.OnModeChangedListener { newMode ->
            val previous = lastCallbackMode
            lastCallbackMode = newMode
            SpikeLog.log("MODE_CB", "onModeChanged ${if (previous == Int.MIN_VALUE) "?" else AudioModes.name(previous)} -> ${AudioModes.describe(newMode)}: ${AudioModes.meaning(newMode)}")
            applyMode(newMode, "callback")
        }
        audio.addOnModeChangedListener(app.mainExecutor, listener)
        modeListener = listener
        SpikeLog.log("MODE_CB", "addOnModeChangedListener registered (no permission needed)")
    }

    private val pollTask = object : Runnable {
        override fun run() {
            val now = SystemClock.elapsedRealtime()
            if (lastTick != 0L && now - lastTick > GAP_MS) {
                SpikeLog.log("GAP", "poll loop didn't run for ${now - lastTick} ms (process frozen or CPU asleep)")
            }
            lastTick = now

            val polled = audio.mode
            if (polled != lastPolledMode) {
                val previous = lastPolledMode
                lastPolledMode = polled
                SpikeLog.log("MODE_POLL", "getMode() ${if (previous == Int.MIN_VALUE) "?" else AudioModes.name(previous)} -> ${AudioModes.describe(polled)}: ${AudioModes.meaning(polled)}")
                applyMode(polled, "poll")
            }
            refreshPhonePermission()

            if (now - lastHeartbeat >= HEARTBEAT_MS) {
                lastHeartbeat = now
                SpikeLog.quiet("HB", "mode=${AudioModes.describe(polled)} telephony=${telephonyState?.let(AudioModes::callStateName) ?: "n/a"}")
            }
            main.postDelayed(this, POLL_MS)
        }
    }

    /** Applies a mode seen by either source and runs the audio-mode call detector. */
    private fun applyMode(newMode: Int, via: String) {
        val modeChanged = newMode != mode
        mode = newMode
        if (AudioModes.isCellularCall(newMode)) {
            pendingModeEnd?.let {
                main.removeCallbacks(it)
                pendingModeEnd = null
                SpikeLog.log("DERIVED", "audio-mode end cancelled: back to ${AudioModes.name(newMode)} within ${END_DEBOUNCE_MS} ms")
            }
            if (modeCallStart == null) {
                modeCallStart = System.currentTimeMillis()
                SpikeLog.log("DERIVED", "CALL START by audio mode (${AudioModes.name(newMode)}, via $via) -> app would show the share banner")
            }
        } else if (modeCallStart != null && pendingModeEnd == null) {
            val end = Runnable {
                pendingModeEnd = null
                val started = modeCallStart
                modeCallStart = null
                val secs = if (started != null) (System.currentTimeMillis() - started) / 1000.0 else 0.0
                SpikeLog.log("DERIVED", "CALL END by audio mode (${AudioModes.name(mode)} for ${END_DEBOUNCE_MS} ms; call lasted ${"%.1f".format(secs)} s)")
                changed()
            }
            pendingModeEnd = end
            main.postDelayed(end, END_DEBOUNCE_MS)
        }
        if (modeChanged) {
            probe("mode ${AudioModes.name(newMode)}")
            changed()
        }
    }

    // ---- Telephony (call state) -------------------------------------------------------------

    fun refreshPhonePermission(force: Boolean = false) {
        val granted = app.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        if (granted == phoneGranted && !force) return
        phoneGranted = granted
        SpikeLog.log("PERM", "READ_PHONE_STATE is ${if (granted) "GRANTED" else "NOT granted"}")
        registerTelephony()
        probe("permission ${if (granted) "granted" else "not granted"}")
        changed()
    }

    private fun registerTelephony() {
        unregisterTelephony()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(state: Int) = onTelephonyState(state, "TelephonyCallback")
            }
            try {
                telephony.registerTelephonyCallback(app.mainExecutor, callback)
                telephonyCallback = callback
                telephonyRegistered = true
                SpikeLog.log("TELEPHONY", "registerTelephonyCallback(CallStateListener) OK")
            } catch (e: SecurityException) {
                telephonyRegistered = false
                telephonyState = null
                SpikeLog.log("TELEPHONY", "registerTelephonyCallback refused: SecurityException: ${e.message}")
            }
        } else {
            @Suppress("DEPRECATION")
            val listener = object : PhoneStateListener() {
                @Deprecated("PhoneStateListener is deprecated in API 31")
                override fun onCallStateChanged(state: Int, phoneNumber: String?) = onTelephonyState(state, "PhoneStateListener")
            }
            try {
                @Suppress("DEPRECATION")
                telephony.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
                phoneStateListener = listener
                telephonyRegistered = true
                SpikeLog.log("TELEPHONY", "PhoneStateListener LISTEN_CALL_STATE OK (permission ${if (phoneGranted) "granted" else "NOT granted"})")
            } catch (e: SecurityException) {
                telephonyRegistered = false
                telephonyState = null
                SpikeLog.log("TELEPHONY", "PhoneStateListener refused: SecurityException: ${e.message}")
            }
        }
    }

    private fun unregisterTelephony() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (telephonyCallback as? TelephonyCallback)?.let { telephony.unregisterTelephonyCallback(it) }
        }
        telephonyCallback = null
        phoneStateListener?.let {
            @Suppress("DEPRECATION")
            telephony.listen(it, PhoneStateListener.LISTEN_NONE)
        }
        phoneStateListener = null
        telephonyRegistered = false
    }

    private fun onTelephonyState(state: Int, via: String) {
        val previous = telephonyState
        telephonyState = state
        SpikeLog.log("TELEPHONY", "$via onCallStateChanged ${previous?.let(AudioModes::callStateName) ?: "?"} -> ${AudioModes.callStateName(state)}")
        if (state == TelephonyManager.CALL_STATE_OFFHOOK && telephonyCallStart == null) {
            telephonyCallStart = System.currentTimeMillis()
            SpikeLog.log("DERIVED", "CALL START by telephony (OFFHOOK)")
        } else if (state == TelephonyManager.CALL_STATE_IDLE && telephonyCallStart != null) {
            val secs = (System.currentTimeMillis() - telephonyCallStart!!) / 1000.0
            telephonyCallStart = null
            SpikeLog.log("DERIVED", "CALL END by telephony (IDLE; call lasted ${"%.1f".format(secs)} s)")
        }
        probe("telephony ${AudioModes.callStateName(state)}")
        changed()
    }

    /** Asks every other call API what it thinks right now, to show which ones work without Phone. */
    private fun probe(reason: String) {
        val parts = mutableListOf<String>()
        parts += try {
            @Suppress("DEPRECATION")
            "getCallState=${AudioModes.callStateName(telephony.callState)}"
        } catch (e: SecurityException) {
            "getCallState=SecurityException"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            parts += try {
                "getCallStateForSubscription=${AudioModes.callStateName(telephony.callStateForSubscription)}"
            } catch (e: SecurityException) {
                "getCallStateForSubscription=SecurityException"
            }
        }
        parts += try {
            "TelecomManager.isInCall=${telecom.isInCall}"
        } catch (e: SecurityException) {
            "TelecomManager.isInCall=SecurityException"
        }
        val text = parts.joinToString(", ")
        lastProbe = text
        SpikeLog.log("PROBE", "$reason: $text")
    }

    // ---- Playback configurations (no permission) --------------------------------------------

    private val playbackCallback = object : AudioManager.AudioPlaybackCallback() {
        override fun onPlaybackConfigChanged(configs: MutableList<AudioPlaybackConfiguration>) {
            updatePlayback(configs, "callback")
        }
    }

    private fun updatePlayback(configs: List<AudioPlaybackConfiguration>, via: String) {
        val usages = configs
            .map { AudioModes.usageName(it.audioAttributes.usage) }
            .groupingBy { it }.eachCount()
            .entries.sortedBy { it.key }
            .joinToString(", ") { if (it.value > 1) "${it.key} x${it.value}" else it.key }
            .ifEmpty { "none" }
        if (usages != playbackUsages) {
            playbackUsages = usages
            SpikeLog.log("PLAYBACK", "active players by usage ($via): $usages")
            changed()
        }
    }

    // ---- Self-tests -------------------------------------------------------------------------

    /** A regular app asks for MODE_IN_CALL. AudioService ignores it without MODIFY_PHONE_STATE. */
    fun selfTestSetInCall() {
        val before = audio.mode
        audio.mode = AudioManager.MODE_IN_CALL
        val after = audio.mode
        SpikeLog.log(
            "SELFTEST",
            "setMode(IN_CALL) from a normal app: before=${AudioModes.name(before)} after=${AudioModes.name(after)} -> " +
                if (after == AudioManager.MODE_IN_CALL) "ACCEPTED (a normal app CAN fake a call)" else "IGNORED (only MODIFY_PHONE_STATE holders can set it)"
        )
        if (after == AudioManager.MODE_IN_CALL) audio.mode = AudioManager.MODE_NORMAL
    }

    /** Acts like a VoIP app: MODE_IN_COMMUNICATION plus a silent VOICE_COMMUNICATION player. */
    fun setVoipSelfTest(on: Boolean) {
        if (on == voipSelfTestOn) return
        voipSelfTestOn = on
        if (on) {
            audio.mode = AudioManager.MODE_IN_COMMUNICATION
            val rate = 16_000
            val minBuffer = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(rate)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(minBuffer * 2)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            voipTrack = track
            track.play()
            thread(name = "voip-silence", isDaemon = true) {
                val silence = ShortArray(rate / 10)
                while (voipSelfTestOn && voipTrack === track) track.write(silence, 0, silence.size)
            }
            SpikeLog.log("SELFTEST", "VoIP self-test ON: setMode(IN_COMMUNICATION) + silent VOICE_COMMUNICATION player; getMode()=${AudioModes.name(audio.mode)}")
        } else {
            voipTrack?.let {
                voipTrack = null
                try { it.stop() } catch (_: IllegalStateException) { }
                it.release()
            }
            audio.mode = AudioManager.MODE_NORMAL
            SpikeLog.log("SELFTEST", "VoIP self-test OFF: getMode()=${AudioModes.name(audio.mode)}")
        }
        changed()
    }
}
