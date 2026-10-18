package live.trackme.app

import android.os.Bundle
import android.view.View
import android.view.ViewTreeObserver
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import live.trackme.app.di.appContainer
import live.trackme.app.ui.navigation.AppViewModel
import live.trackme.app.ui.navigation.TrackMeLiveApp

class MainActivity : ComponentActivity() {
    private val app: AppViewModel by viewModels { AppViewModel.factory(appContainer) }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Edge to edge: the app draws behind the status and navigation bars and pads with insets.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { TrackMeLiveApp(app) }
        holdFirstFrameUntilReady()
    }

    /**
     * Keeps the splash screen (the window background before Android 12) up until the stored setup stage
     * has loaded, so the first frame is already the right screen: no flash of onboarding for someone
     * who is signed in. DataStore answers in a few milliseconds.
     */
    private fun holdFirstFrameUntilReady() {
        val content = findViewById<View>(android.R.id.content)
        content.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (!app.state.value.ready) return false
                content.viewTreeObserver.removeOnPreDrawListener(this)
                return true
            }
        })
    }
}
