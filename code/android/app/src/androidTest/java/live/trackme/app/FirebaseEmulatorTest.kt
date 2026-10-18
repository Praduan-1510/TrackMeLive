package live.trackme.app

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import kotlin.random.Random
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import live.trackme.app.data.auth.DeleteAccountResult
import live.trackme.app.data.auth.SendCodeResult
import live.trackme.app.data.auth.VerifyCodeResult
import live.trackme.app.data.firebase.FirebaseEnvironment
import live.trackme.app.data.profile.FetchProfileResult
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.di.AppContainer
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.Precision
import live.trackme.schema.TmlPaths
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The real data layer against the local Firebase emulators (code/backend/run.sh): phone sign-in on the
 * Auth emulator, saveProfile on the Functions emulator, the users/{uid} listener on Firestore, a
 * restore on "a new phone" (sign out, sign back in) and deleteAccount. Skips when the emulators
 * aren't running, so it never fails a build for want of them.
 */
@RunWith(AndroidJUnit4::class)
class FirebaseEmulatorTest {
    private val container: AppContainer =
        ApplicationProvider.getApplicationContext<TrackMeLiveApplication>().container
    private val host = BuildConfig.FIREBASE_EMULATOR_HOST

    @Before
    fun emulatorsAreUp() {
        assumeTrue("Firebase emulators not running on $host", listOf(9099, 8080, 5001).all { reachable(host, it) })
    }

    @Test
    fun signUpSaveRestoreAndDelete() = runBlocking {
        withTimeout(240_000) {
            container.auth.signOut()
            val number = "+1650555" + Random.nextInt(1000, 9999)

            // Sign up: a code by "text", a wrong try, then the right one.
            assertEquals(SendCodeResult.CodeSent, container.auth.sendCode(number))
            val code = latestCode(number)
            val wrong = ((code.toInt() + 1) % 1_000_000).toString().padStart(6, '0')
            assertEquals(VerifyCodeResult.Wrong, container.auth.verifyCode(wrong))
            val uid = (container.auth.verifyCode(code) as VerifyCodeResult.SignedIn).userId
            assertEquals(uid, container.auth.userId.first { it != null })

            // A new account: no profile yet, then saveProfile creates it with the trimmed name.
            assertEquals(FetchProfileResult.NotFound, container.profiles.fetch())
            val created = container.profiles.create("  Emulator Test ") as SaveProfileResult.Saved
            assertEquals("Emulator Test", created.profile.name)
            assertEquals(MascotId.FOX, created.profile.mascotId)
            val live = container.profiles.profile.first { it is ProfileState.Ready && it.profile.updatedAtMillis >= created.profile.updatedAtMillis }
            assertEquals("Emulator Test", (live as ProfileState.Ready).profile.name)

            // The mascot, then a synced setting, each saved whole and read back through the listener.
            assertTrue(container.profiles.update { it.copy(mascotId = MascotId.GHOST, mascotColor = MascotColor.LAGOON, mascotAccessory = MascotAccessory.HEADLAMP) } is SaveProfileResult.Saved)
            val settings = container.settings.updateSynced { it.copy(precision = Precision.APPROXIMATE, shareBack = false) } as SaveProfileResult.Saved
            container.profiles.profile.first {
                it is ProfileState.Ready && it.profile.updatedAtMillis >= settings.profile.updatedAtMillis && it.profile.settings.precision == Precision.APPROXIMATE
            }

            // "A new phone": sign out, sign back in with the same number; the profile comes back as it was.
            // Firebase won't text the same number again until the last request's 60 s auto-retrieval
            // window has passed, so wait it out.
            container.auth.signOut()
            delay(61_000)
            assertEquals(ProfileState.SignedOut, container.profiles.profile.first { it == ProfileState.SignedOut })
            assertEquals(SendCodeResult.CodeSent, container.auth.sendCode(number))
            assertEquals(uid, (container.auth.verifyCode(latestCode(number)) as VerifyCodeResult.SignedIn).userId)
            val restored = (container.profiles.fetch() as FetchProfileResult.Found).profile
            assertEquals("Emulator Test", restored.name)
            assertEquals(MascotId.GHOST, restored.mascotId)
            assertEquals(MascotColor.LAGOON, restored.mascotColor)
            assertEquals(MascotAccessory.HEADLAMP, restored.mascotAccessory)
            assertEquals(Precision.APPROXIMATE, restored.settings.precision)
            assertEquals(false, restored.settings.shareBack)

            // Delete account: everything goes on the server, and on this phone the sign-in and Firestore's
            // cache go too. The cache held the profile before; afterwards nothing of it is readable.
            assertTrue(cachedProfileExists(uid))
            assertEquals(DeleteAccountResult.Deleted, container.account.deleteAccount())
            assertNull(container.auth.userId.first { it == null })
            assertFalse("users/$uid is still in the on-device cache", cachedProfileExists(uid))
        }
    }

    /** Whether Firestore's on-device cache (the current instance) holds users/{uid}. */
    private suspend fun cachedProfileExists(uid: String): Boolean = try {
        FirebaseFirestore.getInstance(FirebaseApp.getInstance()).document(TmlPaths.user(uid)).get(Source.CACHE).await().exists()
    } catch (_: FirebaseFirestoreException) {
        false // "Failed to get document from cache": not there
    }

    /** The newest code the Auth emulator "texted" to [number] (its REST API; no SMS is ever sent). */
    private fun latestCode(number: String): String {
        val url = URL("http://$host:9099/emulator/v1/projects/${FirebaseEnvironment.DEMO_PROJECT_ID}/verificationCodes")
        val body = (url.openConnection() as HttpURLConnection).run {
            connectTimeout = 5_000
            readTimeout = 5_000
            try {
                inputStream.bufferedReader().readText()
            } finally {
                disconnect()
            }
        }
        val codes = JSONObject(body).getJSONArray("verificationCodes")
        return (codes.length() - 1 downTo 0).map { codes.getJSONObject(it) }
            .first { it.getString("phoneNumber") == number }
            .getString("code")
    }

    private fun reachable(host: String, port: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(host, port), 1_500) }
        true
    } catch (_: java.io.IOException) {
        false
    }
}
