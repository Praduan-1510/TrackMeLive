package live.trackme.app

import android.Manifest
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.Source
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import kotlin.random.Random
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import live.trackme.app.data.auth.SendCodeResult
import live.trackme.app.data.auth.VerifyCodeResult
import live.trackme.app.data.firebase.FirebaseEnvironment
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.data.sharing.CreateShareResult
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UpdateShareResult
import live.trackme.app.di.AppContainer
import live.trackme.app.service.LocationSharingService
import live.trackme.schema.Ping
import live.trackme.schema.Precision
import live.trackme.schema.ShareSession
import live.trackme.schema.StopMinutes
import live.trackme.schema.TmlPaths
import live.trackme.schema.TmlSchemaConstants
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A walk fed to the emulator's GPS reaches the dev Firestore as pings (FSD §6, §7), and Stop ends them.
 *
 * Needs a route being fed while it runs, so it runs only from `code/android/scripts/route-check.sh`
 * (which passes `-e route true` and runs `adb emu geo fix` every second) and is skipped otherwise,
 * including from connectedDebugAndroidTest. Skipped too when the Firebase emulators aren't running.
 * It signs in a new test account and deletes it at the end.
 */
@RunWith(AndroidJUnit4::class)
class SharingRouteTest {
    private val app = ApplicationProvider.getApplicationContext<TrackMeLiveApplication>()
    private val container: AppContainer = app.container
    private val host = BuildConfig.FIREBASE_EMULATOR_HOST

    @Before
    fun routeAndEmulators() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("no route being fed (run scripts/route-check.sh)", args.getString("route") == "true")
        assumeTrue("Firebase emulators not running on $host", listOf(9099, 8080, 5001).all { reachable(host, it) })
    }

    @Test
    fun aFedRouteBecomesSpacedPingsUntilStop() = runBlocking {
        withTimeout(240_000) {
            grant(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, "android.permission.POST_NOTIFICATIONS")
            signInNewAccount()
            // The location service may start only from the foreground (Android 12+).
            val scenario = ActivityScenario.launch(MainActivity::class.java)
            try {
                // On the main thread, as the screens call it.
                val created = withContext(Dispatchers.Main) {
                    container.sharing.createSession(
                        ShareRequest(StopChoice.After(StopMinutes.MINUTES_15), Precision.PRECISE, shareBackAllowed = false, viewerName = "Route"),
                    )
                } as CreateShareResult.Created
                val id = created.share.sessionId
                assertTrue(created.share.linkUrl.contains(TmlSchemaConstants.SHARE_LINK_PATH))
                // The service comes up a moment after it's asked for.
                assertTrue("the location service runs while sharing", eventually { LocationSharingService.running })

                // The timer sheet, against the dev rules: In 30 min from now, on the server's clock (±60 s).
                assertEquals(UpdateShareResult.Updated, withContext(Dispatchers.Main) { container.sharing.changeStop(StopChoice.After(StopMinutes.MINUTES_30)) })
                val stopAt = sessionDoc(id).getTimestamp(ShareSession.Fields.STOP_AT)!!.millis
                assertTrue("stop_at $stopAt", kotlin.math.abs(stopAt - (created.share.startedAtMillis + 30 * 60_000L)) < 60_000)

                // Pings arrive from the fed route.
                val pings = waitForPings(id, atLeast = 4)
                val route = pings.map { it.lat to it.lng }
                assertTrue("pings follow the fed route: $route", route.all { (lat, lng) -> lat in 37.80..37.82 && lng in -122.28..-122.26 })
                val times = pings.map { it.recordedAt.millis }.sorted()
                times.zipWithNext().forEach { (a, b) ->
                    assertTrue("pings at least 2 s apart: $times", b - a >= TmlSchemaConstants.MIN_PING_SPACING_SECONDS * 1000L)
                }
                val session = sessionDoc(id)
                assertEquals("last_fix_at is the newest ping's recorded_at", times.last(), session.getTimestamp(ShareSession.Fields.LAST_FIX_AT)?.millis)
                val interval = session.getDouble(ShareSession.Fields.PING_INTERVAL_S)!!
                assertTrue("ping_interval_s $interval", interval in 3.0..60.0)

                // Stop: the share ends at once on the phone, the server records it, and no ping lands after.
                withContext(Dispatchers.Main) {
                    container.sharing.stop()
                    assertTrue(container.sharing.state.value is ShareState.Ended)
                }
                val ended = container.sharing.state.first { it is ShareState.Ended && it.end.confirmed } as ShareState.Ended
                val countAtStop = pingsOf(id).size()
                delay(10_000)
                val after = pingsOf(id)
                assertEquals("no ping after Stop", countAtStop, after.size())
                assertTrue(after.documents.all { it.toObject(Ping::class.java)!!.recordedAt.millis <= ended.end.atMillis })
                assertEquals("stopped", sessionDoc(id).getString(ShareSession.Fields.STATUS))
                assertTrue("the location service stops with the share", eventually { !LocationSharingService.running })
                withContext(Dispatchers.Main) { container.sharing.dismissEnded() }
            } finally {
                scenario.close()
                withContext(Dispatchers.Main) { container.account.deleteAccount() }
            }
        }
    }

    /** True once [check] is, within 5 s. */
    private suspend fun eventually(check: () -> Boolean): Boolean {
        repeat(50) {
            if (check()) return true
            delay(100)
        }
        return check()
    }

    private suspend fun waitForPings(sessionId: String, atLeast: Int): List<Ping> {
        while (true) {
            val pings = pingsOf(sessionId).documents.mapNotNull { it.toObject(Ping::class.java) }
            if (pings.size >= atLeast) return pings
            delay(2_000)
        }
    }

    private suspend fun pingsOf(sessionId: String): QuerySnapshot =
        firestore().collection(TmlPaths.pingCollection(sessionId)).get(Source.SERVER).await()

    private suspend fun sessionDoc(sessionId: String) =
        firestore().document(TmlPaths.shareSession(sessionId)).get(Source.SERVER).await()

    private fun firestore() = FirebaseFirestore.getInstance(FirebaseApp.getInstance())

    private suspend fun signInNewAccount() {
        container.auth.signOut()
        val number = "+1650556" + Random.nextInt(1000, 9999)
        assertEquals(SendCodeResult.CodeSent, container.auth.sendCode(number))
        assertTrue(container.auth.verifyCode(latestCode(number)) is VerifyCodeResult.SignedIn)
        assertTrue(container.profiles.create("Route Test") is SaveProfileResult.Saved)
    }

    private fun grant(vararg permissions: String) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        permissions.forEach { automation.grantRuntimePermission(app.packageName, it) }
        container.locationPermissions.refresh()
    }

    /** The newest code the Auth emulator "texted" to [number]. */
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
    } catch (_: Exception) {
        false
    }

    private val Timestamp.millis: Long get() = seconds * 1000L + nanoseconds / 1_000_000
}
