package live.trackme.spike.calldetect

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * One screen: the live audio mode, the telephony call state (with Phone), what each detector
 * concludes, and the event log. Every button can also be driven from adb for scripted runs:
 *   adb shell am start -n live.trackme.spike.calldetect/.MainActivity --es cmd <command>
 * Commands: request-phone, fgs-start, fgs-stop, selftest-incall, voip-on, voip-off, clear.
 */
class MainActivity : Activity() {

    private companion object {
        const val REQ_PHONE = 1
        const val REQ_SERVICE = 2
        val CLOCK = SimpleDateFormat("HH:mm:ss", Locale.US)
    }

    private lateinit var status: TextView
    private lateinit var events: TextView
    private lateinit var voipButton: Button
    private lateinit var serviceButton: Button
    private val renderListener: () -> Unit = { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CallMonitor.start(this)
        setContentView(buildUi())
        SpikeLog.addListener(renderListener)
        CallMonitor.addListener(renderListener)
        handleCommand(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleCommand(intent)
    }

    override fun onResume() {
        super.onResume()
        SpikeLog.uiState = "resumed"
        SpikeLog.log("UI", "activity resumed (app in foreground)")
        CallMonitor.refreshPhonePermission()
        render()
    }

    override fun onPause() {
        SpikeLog.uiState = "paused"
        SpikeLog.log("UI", "activity paused")
        super.onPause()
    }

    override fun onStop() {
        SpikeLog.uiState = "stopped"
        SpikeLog.log("UI", "activity stopped (app in background)")
        super.onStop()
    }

    override fun onDestroy() {
        SpikeLog.removeListener(renderListener)
        CallMonitor.removeListener(renderListener)
        SpikeLog.uiState = "none"
        super.onDestroy()
    }

    // ---- Commands -----------------------------------------------------------------------------

    private fun handleCommand(intent: Intent?) {
        if (intent == null) return
        val cmd = intent.getStringExtra("cmd") ?: return
        intent.removeExtra("cmd")
        SpikeLog.log("CMD", cmd)
        when (cmd) {
            "request-phone" -> requestPhone()
            "fgs-start" -> startShareService()
            "fgs-stop" -> ShareService.stop(this)
            "selftest-incall" -> CallMonitor.selfTestSetInCall()
            "voip-on" -> CallMonitor.setVoipSelfTest(true)
            "voip-off" -> CallMonitor.setVoipSelfTest(false)
            "clear" -> SpikeLog.clear()
            else -> SpikeLog.log("CMD", "unknown command: $cmd")
        }
    }

    private fun requestPhone() {
        val rationale = shouldShowRequestPermissionRationale(Manifest.permission.READ_PHONE_STATE)
        SpikeLog.log("PERM", "requesting READ_PHONE_STATE (rationale=$rationale)")
        requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQ_PHONE)
    }

    private fun startShareService() {
        val missing = buildList {
            if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                add(Manifest.permission.ACCESS_COARSE_LOCATION)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (Manifest.permission.ACCESS_COARSE_LOCATION in missing) {
            SpikeLog.log("PERM", "the location service needs location first: requesting ${missing.joinToString()}")
            requestPermissions(missing.toTypedArray(), REQ_SERVICE)
            return
        }
        ShareService.start(this)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val result = permissions.indices.joinToString { i ->
            "${permissions[i].substringAfterLast('.')}=${if (grantResults.getOrNull(i) == PackageManager.PERMISSION_GRANTED) "granted" else "denied"}"
        }
        SpikeLog.log("PERM", "result: ${result.ifEmpty { "dialog dismissed" }}")
        CallMonitor.refreshPhonePermission()
        if (requestCode == REQ_SERVICE &&
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        ) {
            ShareService.start(this)
        }
        render()
    }

    // ---- UI -----------------------------------------------------------------------------------

    private fun buildUi(): View {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(24))
        }
        column.addView(TextView(this).apply {
            text = "Call detect spike"
            textSize = 22f
            setTypeface(typeface, Typeface.BOLD)
        })
        column.addView(TextView(this).apply {
            text = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL} · targetSdk ${applicationInfo.targetSdkVersion}"
            textSize = 13f
            setPadding(0, dp(4), 0, dp(12))
        })
        status = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 13f
            setTextIsSelectable(true)
        }
        column.addView(status)

        fun button(label: String, onClick: () -> Unit) = Button(this).apply {
            text = label
            isAllCaps = false
            setOnClickListener { onClick() }
            column.addView(this, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        button("Request Phone permission") { requestPhone() }
        serviceButton = button("Start background service") {
            if (ShareService.running) ShareService.stop(this) else startShareService()
            status.postDelayed({ render() }, 300)
        }
        button("Self-test: setMode(IN_CALL) as a normal app") { CallMonitor.selfTestSetInCall() }
        voipButton = button("Self-test: act like a VoIP app") { CallMonitor.setVoipSelfTest(!CallMonitor.voipSelfTestOn) }
        button("Clear log") { SpikeLog.clear() }

        column.addView(TextView(this).apply {
            text = "Events, newest first (also in logcat, tag CallSpike, and files/events.log)"
            textSize = 13f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(16), 0, dp(4))
        })
        events = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 11f
            setTextIsSelectable(true)
        }
        column.addView(events)

        return ScrollView(this).apply {
            addView(column)
            setOnApplyWindowInsetsListener { view, insets ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                } else {
                    @Suppress("DEPRECATION")
                    view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                }
                insets
            }
        }
    }

    private fun render() {
        if (!::status.isInitialized) return
        val mode = CallMonitor.mode
        val modeCall = CallMonitor.modeCallStart?.let { "IN A CALL since ${CLOCK.format(Date(it))}" } ?: "no call"
        val telephony = when {
            !CallMonitor.telephonyRegistered -> "not available (needs Phone permission on API 31+)"
            else -> CallMonitor.telephonyState?.let(AudioModes::callStateName) ?: "registered, waiting for first callback"
        }
        val telephonyCall = when {
            !CallMonitor.telephonyRegistered -> "n/a"
            else -> CallMonitor.telephonyCallStart?.let { "IN A CALL since ${CLOCK.format(Date(it))}" } ?: "no call"
        }
        status.text = buildString {
            appendLine("Audio mode        ${AudioModes.describe(mode)}")
            appendLine("                  ${AudioModes.meaning(mode)}")
            appendLine("Audio-mode result $modeCall")
            appendLine("Phone permission  ${if (CallMonitor.phoneGranted) "granted" else "not granted"}")
            appendLine("Telephony state   $telephony")
            appendLine("Telephony result  $telephonyCall")
            appendLine("Other APIs        ${CallMonitor.lastProbe}")
            appendLine("Active players    ${CallMonitor.playbackUsages}")
            append("Process           ${SpikeLog.appState()}")
        }
        serviceButton.text = if (ShareService.running) "Stop background service" else "Start background service"
        voipButton.text = if (CallMonitor.voipSelfTestOn) "Self-test: stop acting like a VoIP app" else "Self-test: act like a VoIP app"
        events.text = SpikeLog.snapshot().joinToString("\n") { it.format() }
    }
}
