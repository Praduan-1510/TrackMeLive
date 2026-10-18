package live.trackme.app.service

import android.app.Application
import android.app.NotificationManager
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import java.util.TimeZone
import live.trackme.app.data.sharing.GpsSignal
import live.trackme.app.data.sharing.SharedPoint
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UploadStatus
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class SharingIntentsTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val request = ShareRequest(StopChoice.After(StopMinutes.MINUTES_30), Precision.PRECISE, false)

    private fun live() = FakeSharingRepository().also {
        val share = FakeSharingRepository.shareFor(request)
        it.emit(ShareState.Live(share, FakeSharingRepository.sessionFor(share, request), UploadStatus.Initial))
    }

    @Test
    fun `Stop sharing opens the live screen with its Stop dialog`() {
        val sharing = live()
        assertEquals(SharingIntents.Request.ConfirmStop, SharingIntents.handle(Intent(SharingIntents.ACTION_CONFIRM_STOP), sharing))
        assertTrue(sharing.stopConfirmationRequested.value)
    }

    @Test
    fun `Open and the notification itself open the live screen`() {
        val sharing = live()
        assertEquals(SharingIntents.Request.OpenShare, SharingIntents.handle(Intent(SharingIntents.ACTION_OPEN_SHARE), sharing))
        assertFalse(sharing.stopConfirmationRequested.value)
    }

    @Test
    fun `a tap after the share ended, or any other intent, asks for nothing`() {
        val idle = FakeSharingRepository()
        assertNull(SharingIntents.handle(Intent(SharingIntents.ACTION_CONFIRM_STOP), idle))
        assertFalse(idle.stopConfirmationRequested.value)
        assertNull(SharingIntents.handle(Intent(Intent.ACTION_MAIN), live()))
        assertNull(SharingIntents.handle(Intent(), live()))
        assertNull(SharingIntents.handle(null, live()))
    }

    @Test
    fun `the pending intents start MainActivity with their action`() {
        val stop = shadowOf(SharingIntents.confirmStop(context)).savedIntent
        assertEquals(SharingIntents.ACTION_CONFIRM_STOP, stop.action)
        assertEquals("live.trackme.app.MainActivity", stop.component?.className)
        assertTrue(stop.flags and Intent.FLAG_ACTIVITY_SINGLE_TOP != 0)
        assertEquals(SharingIntents.ACTION_OPEN_SHARE, shadowOf(SharingIntents.openShare(context)).savedIntent.action)
        assertTrue(shadowOf(SharingIntents.openShare(context)).isActivityIntent)
    }
}

@RunWith(RobolectricTestRunner::class)
class SharingNotificationTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val start = FakeSharingRepository.START_MILLIS
    private var zone: TimeZone? = null

    @Before
    fun utc() {
        zone = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    @After
    fun restore() {
        TimeZone.setDefault(zone)
    }

    private fun live(stop: StopChoice, name: String? = "Mom", upload: UploadStatus = UploadStatus.Initial): ShareState.Live {
        val request = ShareRequest(stop, Precision.PRECISE, false, viewerName = name)
        val share = FakeSharingRepository.shareFor(request, startedAt = start)
        return ShareState.Live(share, FakeSharingRepository.sessionFor(share, request), upload)
    }

    private fun content(state: ShareState.Live, now: Long = start) = SharingNotification.content(context, state, now)

    @Test
    fun `the title says who it's for, or just that it's sharing`() {
        // The name is wrapped in invisible direction marks; without them it reads as written.
        val title = content(live(StopChoice.AtLimit)).title.filter { Character.getType(it) != Character.FORMAT.toInt() }
        assertEquals("Sharing your location with Mom", title)
        assertEquals("Sharing your location", content(live(StopChoice.AtLimit, name = null)).title)
        assertEquals("Sharing your location", content(live(StopChoice.AtLimit, name = "  ")).title)
    }

    @Test
    fun `the second line says when sharing stops`() {
        // 21:38 UTC start; Robolectric's time format is 12-hour.
        assertEquals("Until 10:08 PM", content(live(StopChoice.After(StopMinutes.MINUTES_30))).text)
        assertEquals("Until the call ends", content(live(StopChoice.WhenCallEnds)).text)
        assertEquals("Until 10:38 PM", content(live(StopChoice.AtLimit)).text)
    }

    @Test
    fun `5 minutes before the limit it says so`() {
        assertEquals("Sharing stops at 10:38 PM · 1-hour limit", content(live(StopChoice.AtLimit), now = start + 55 * 60_000L).text)
    }

    @Test
    fun `no GPS or no connection, with the last seen time`() {
        val point = SharedPoint(1.0, 2.0, 10.0, start + 3 * 60_000L, Precision.PRECISE)
        assertEquals("No GPS signal", content(live(StopChoice.AtLimit, upload = UploadStatus.Initial.copy(signal = GpsSignal.NoSignal))).text)
        assertEquals(
            "No GPS signal · last seen 9:41 PM",
            content(live(StopChoice.AtLimit, upload = UploadStatus.Initial.copy(signal = GpsSignal.NoSignal, lastPoint = point))).text,
        )
        assertEquals(
            "No connection · last seen 9:41 PM",
            content(live(StopChoice.AtLimit, upload = UploadStatus.Initial.copy(offline = true, lastPoint = point))).text,
        )
        assertEquals("No connection", content(live(StopChoice.AtLimit, upload = UploadStatus.Initial.copy(offline = true))).text)
    }

    @Test
    fun `before the session doc arrives there's only the title`() {
        val state = live(StopChoice.AtLimit).copy(session = null)
        assertNull(content(state).text)
    }

    @Test
    fun `the notification is ongoing and silent, with Open and Stop sharing`() {
        SharingNotification.createChannel(context)
        val n = SharingNotification.build(context, SharingNotification.Content("Sharing your location", "Until 10:08 PM"))
        assertTrue(n.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0)
        assertEquals(listOf("Open", "Stop sharing"), n.actions.map { it.title.toString() })
        assertEquals(SharingNotification.CHANNEL_ID, n.channelId)
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(SharingNotification.CHANNEL_ID)
        assertEquals("Sharing in progress", channel.name)
        assertEquals(NotificationManager.IMPORTANCE_LOW, channel.importance)
    }
}
