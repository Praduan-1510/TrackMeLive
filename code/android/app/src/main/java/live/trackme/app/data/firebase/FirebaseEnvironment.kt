package live.trackme.app.data.firebase

import com.google.firebase.FirebaseOptions
import live.trackme.app.BuildConfig

/**
 * Which Firebase project the app talks to, and how.
 *
 * Today there is only the offline demo project on the local emulators (code/backend/run.sh). When the
 * real project exists, add its options here (or read them from google-services.json through the
 * google-services plugin) and pick it for release builds. Nothing else in the app changes: everything
 * reaches Firebase through [FirebaseServices].
 */
sealed interface FirebaseEnvironment {
    val options: FirebaseOptions

    /** The Cloud Functions region: must match the backend's (code/backend/functions/src/index.ts). */
    val functionsRegion: String

    /**
     * The demo project on the Firebase emulators. Any API key works there, and no google-services.json
     * is needed. [host] is the Mac's loopback as the Android emulator sees it (10.0.2.2), or its LAN
     * address for a physical phone (see app/build.gradle.kts).
     */
    data class Emulators(
        val host: String,
        val authPort: Int = 9099,
        val firestorePort: Int = 8080,
        val functionsPort: Int = 5001,
    ) : FirebaseEnvironment {
        override val options: FirebaseOptions = FirebaseOptions.Builder()
            .setProjectId(DEMO_PROJECT_ID)
            .setApplicationId("1:000000000000:android:0000000000000000")
            // Any key works on the emulators, but Firebase Installations checks the format: AIzaSy + 33 characters.
            .setApiKey("AIzaSy" + "0".repeat(33))
            .build()
        override val functionsRegion: String = "us-central1"
    }

    companion object {
        /** The offline demo project: the `demo-` prefix keeps the emulators from ever calling real services. */
        const val DEMO_PROJECT_ID = "demo-trackmelive"

        /** The environment this build uses. */
        fun forBuild(): FirebaseEnvironment {
            check(BuildConfig.USE_FIREBASE_EMULATORS) {
                "No production Firebase project is configured yet. Release builds need FirebaseEnvironment.Production."
            }
            return Emulators(host = BuildConfig.FIREBASE_EMULATOR_HOST)
        }
    }
}
