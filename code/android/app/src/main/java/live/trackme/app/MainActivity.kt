package live.trackme.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import live.trackme.app.ui.TrackMeLiveApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Edge to edge: the app draws behind the status and navigation bars and pads with insets.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { TrackMeLiveApp() }
    }
}
