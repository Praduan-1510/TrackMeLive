package live.trackme.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewTreeObserver
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import live.trackme.app.di.appContainer
import live.trackme.app.service.SharingIntents
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
        // A cold start from the ongoing notification; a recreated activity has handled its intent already.
        if (savedInstanceState == null) handleSharingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleSharingIntent(intent)
    }

    /**
     * The ongoing notification's taps (service/SharingIntents): Open shows the live map; Stop sharing shows
     * it with the Stop dialog asking first (the app's view model follows stopConfirmationRequested).
     */
    private fun handleSharingIntent(intent: Intent?) {
        when (SharingIntents.handle(intent, appContainer.sharing)) {
            SharingIntents.Request.OpenShare, SharingIntents.Request.ConfirmStop -> app.openLive()
            null -> Unit
        }
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
