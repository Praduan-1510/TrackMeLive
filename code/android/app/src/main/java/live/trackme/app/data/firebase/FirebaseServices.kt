package live.trackme.app.data.firebase

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.tasks.await

/**
 * The Firebase SDKs, set up once for [environment]. Each SDK is pointed at its emulator before its
 * first use, as Firebase requires. Built by the app container; nothing else calls Firebase's
 * getInstance() functions.
 */
class FirebaseServices(context: Context, private val environment: FirebaseEnvironment) {
    val app: FirebaseApp = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
        ?: FirebaseApp.initializeApp(context, environment.options)

    val auth: FirebaseAuth = FirebaseAuth.getInstance(app)
    val functions: FirebaseFunctions = FirebaseFunctions.getInstance(app, environment.functionsRegion)

    /** The current Firestore instance. It's replaced by [clearFirestoreCache], so always read it here. */
    @Volatile
    var firestore: FirebaseFirestore = newFirestore()
        private set

    init {
        if (environment is FirebaseEnvironment.Emulators) {
            auth.useEmulator(environment.host, environment.authPort)
            functions.useEmulator(environment.host, environment.functionsPort)
            // The Auth emulator sends no texts and needs no Play Integrity or reCAPTCHA check. Only ever
            // set against the emulators: this is never reached in a build that talks to a real project.
            auth.firebaseAuthSettings.setAppVerificationDisabledForTesting(true)
        }
    }

    /**
     * Deletes everything Firestore keeps on this phone (the cached users/{uid} and any queued writes):
     * terminate the instance, clear its persistence, then start a fresh one for the next sign-in.
     * Call it signed out, after the listeners have stopped.
     */
    suspend fun clearFirestoreCache() {
        val old = firestore
        old.terminate().await()
        old.clearPersistence().await()
        firestore = newFirestore()
    }

    /** A Firestore instance, on the emulator when [environment] says so (before any use, as required). */
    private fun newFirestore(): FirebaseFirestore = FirebaseFirestore.getInstance(app).also {
        if (environment is FirebaseEnvironment.Emulators) it.useEmulator(environment.host, environment.firestorePort)
    }
}
