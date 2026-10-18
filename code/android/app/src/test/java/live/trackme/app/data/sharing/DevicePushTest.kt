package live.trackme.app.data.sharing

import android.app.Application
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.google.firebase.firestore.FieldValue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.app.service.LinkOpenedAlert
import live.trackme.app.service.SharingIntents
import live.trackme.schema.Precision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** On Robolectric for android.util.Log and SharedPreferences. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DevicePushTest {
    private class FakeRegistry : DeviceRegistry {
        val writes = mutableListOf<Triple<String, String, String>>()
        val deletes = mutableListOf<Pair<String, String>>()
        var failure: SharingDataException? = null

        override suspend fun write(userId: String, deviceId: String, pushToken: String) {
            failure?.let { throw it }
            writes += Triple(userId, deviceId, pushToken)
        }

        override suspend fun delete(userId: String, deviceId: String) {
            failure?.let { throw it }
            deletes += userId to deviceId
        }
    }

    private inner class Harness(scope: TestScope) {
        val userId = MutableStateFlow<String?>("alex")
        val hasProfile = MutableStateFlow(true)
        var token: String? = "fcm-1"
        val registry = FakeRegistry()
        val push = DefaultPushRegistration(userId, { userId.value }, hasProfile, { token }, registry, { "device-1" }, scope.backgroundScope)
    }

    @Test
    fun `signed in with a profile, this launch writes the device doc`() = runTest {
        val h = Harness(this)
        h.push.start()
        runCurrent()
        assertEquals(listOf(Triple("alex", "device-1", "fcm-1")), h.registry.writes)
        // Once per launch: a share starting doesn't write it again.
        h.push.ensureRegistered()
        assertEquals(1, h.registry.writes.size)
    }

    @Test
    fun `not before the profile exists, nor signed out`() = runTest {
        val h = Harness(this)
        h.hasProfile.value = false
        h.userId.value = null
        h.push.start()
        runCurrent()
        assertTrue(h.registry.writes.isEmpty())
        h.userId.value = "alex"
        runCurrent()
        assertTrue(h.registry.writes.isEmpty())
        h.hasProfile.value = true
        runCurrent()
        assertEquals(1, h.registry.writes.size)
    }

    @Test
    fun `no token yet (the demo project) is no write and no error, tried again when a share starts`() = runTest {
        val h = Harness(this)
        h.token = null
        h.push.start()
        runCurrent()
        assertTrue(h.registry.writes.isEmpty())
        h.token = "fcm-2"
        h.push.ensureRegistered()
        assertEquals(listOf(Triple("alex", "device-1", "fcm-2")), h.registry.writes)
    }

    @Test
    fun `a failed write is logged and tried again later`() = runTest {
        val h = Harness(this)
        h.registry.failure = SharingDataException(SharingFailure.Network)
        h.push.start()
        runCurrent()
        h.registry.failure = null
        h.push.ensureRegistered()
        assertEquals(1, h.registry.writes.size)
    }

    @Test
    fun `a new token rewrites the doc, and another account gets its own`() = runTest {
        val h = Harness(this)
        h.push.start()
        runCurrent()
        h.push.onNewToken("fcm-new")
        runCurrent()
        assertEquals(Triple("alex", "device-1", "fcm-new"), h.registry.writes.last())
        h.userId.value = "sam"
        runCurrent()
        assertEquals("sam", h.registry.writes.last().first)
    }

    @Test
    fun `before signing out the doc is deleted, and a failure there doesn't stop the sign-out`() = runTest {
        val h = Harness(this)
        h.push.unregister()
        assertEquals(listOf("alex" to "device-1"), h.registry.deletes)
        h.registry.failure = SharingDataException(SharingFailure.Network)
        h.push.unregister()
        h.userId.value = null
        h.push.unregister()
        assertEquals(1, h.registry.deletes.size)
    }

    @Test
    fun `the device doc has exactly the four fields the rules allow`() {
        val fields = FirestoreDeviceRegistry.deviceFields("tok")
        assertEquals(setOf("platform", "push_token", "live_activity_start_token", "updated_at"), fields.keys)
        assertEquals("android", fields["platform"])
        assertEquals("tok", fields["push_token"])
        assertNull(fields["live_activity_start_token"])
        assertEquals(FieldValue.serverTimestamp(), fields["updated_at"])
    }

    @Test
    fun `the install id is made once and kept`() {
        val prefs = ApplicationProvider.getApplicationContext<Application>().getSharedPreferences("test_install", Context.MODE_PRIVATE)
        val first = InstallId(prefs).get()
        assertEquals(36, first.length)
        assertEquals(first, InstallId(prefs).get())
    }

    @Test
    fun `a link-opened tap opens the live screen for the running share, otherwise Home`() {
        val request = ShareRequest(StopChoice.AtLimit, Precision.PRECISE, false)
        val sharing = FakeSharingRepository().also {
            val share = FakeSharingRepository.shareFor(request)
            it.emit(ShareState.Live(share, FakeSharingRepository.sessionFor(share, request), UploadStatus.Initial))
        }
        fun tap(sessionId: String) = Intent(Intent.ACTION_MAIN)
            .putExtra(LinkOpenedAlert.EXTRA_TYPE, LinkOpenedAlert.TYPE)
            .putExtra(LinkOpenedAlert.EXTRA_SESSION_ID, sessionId)
        assertEquals(SharingIntents.Request.OpenShare, SharingIntents.handle(tap("session-1"), sharing))
        assertNull(SharingIntents.handle(tap("an-old-one"), sharing))
        assertNull(SharingIntents.handle(tap("session-1"), FakeSharingRepository()))
    }

    @Test
    fun `a link-opened alert with the app open shows on its channel, and its tap carries the session`() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        org.robolectric.Shadows.shadowOf(app).grantPermissions("android.permission.POST_NOTIFICATIONS")
        LinkOpenedAlert.show(app, "s-1", "Mom opened your link", "You're live on their map.")
        val manager = app.getSystemService(android.app.NotificationManager::class.java)
        val posted = org.robolectric.Shadows.shadowOf(manager).getNotification("link_opened:s-1", 0)
        assertEquals("link_opened", posted.channelId)
        assertEquals("Link opened", manager.getNotificationChannel("link_opened").name)
        assertEquals("Mom opened your link", posted.extras.getString(android.app.Notification.EXTRA_TITLE))
        val tap = org.robolectric.Shadows.shadowOf(posted.contentIntent).savedIntent
        assertEquals("link_opened", tap.getStringExtra(LinkOpenedAlert.EXTRA_TYPE))
        assertEquals("s-1", tap.getStringExtra(LinkOpenedAlert.EXTRA_SESSION_ID))
    }
}
