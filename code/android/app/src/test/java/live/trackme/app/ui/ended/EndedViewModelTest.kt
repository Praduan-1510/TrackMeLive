package live.trackme.app.ui.ended

import androidx.test.ext.junit.runners.AndroidJUnit4
import live.trackme.app.data.sharing.ShareEnd
import live.trackme.app.data.sharing.ShareRequest
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.StopChoice
import live.trackme.app.data.sharing.UploadStatus
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.share.Audience
import live.trackme.schema.EndReason
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.Precision
import live.trackme.schema.SharerSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Robolectric for android.icu (the name rule). */
@RunWith(AndroidJUnit4::class)
class EndedViewModelTest {
    private val start = FakeSharingRepository.START_MILLIS
    private val request = ShareRequest(StopChoice.AtLimit, Precision.PRECISE, false, viewerName = "Mom")
    private val share = FakeSharingRepository.shareFor(request)
    private val session = FakeSharingRepository.sessionFor(share, request)
        .copy(sharer = SharerSnapshot("Alex", MascotId.GHOST, MascotColor.ROSE, MascotAccessory.HEADLAMP))

    private fun ended(reason: EndReason, at: Long, edit: (live.trackme.app.data.sharing.SessionView) -> live.trackme.app.data.sharing.SessionView = { it }) =
        ShareState.Ended(share, ShareEnd(reason, at, confirmed = true), edit(session))

    @Test
    fun eachEndReasonIsPresented() {
        EndReason.entries.forEach { reason ->
            val s = EndedViewModel.present(ended(reason, start + 12 * 60_000))
            assertTrue(s.ended)
            assertEquals(reason, s.reason)
            assertEquals("Share again only at the limit", reason == EndReason.LIMIT, s.offersShareAgain)
            assertEquals(start, s.startedAtMillis)
            assertEquals(start + 12 * 60_000, s.endedAtMillis)
        }
    }

    @Test
    fun theSummaryComesFromTheSession() {
        val s = EndedViewModel.present(ended(EndReason.STOPPED, start + 60_000) { it.copy(firstViewedAtMillis = start + 30_000, viewerSharing = true) })
        assertEquals(Audience("Mom"), s.audience)
        assertEquals(MascotLook(MascotId.GHOST, MascotColor.ROSE, MascotAccessory.HEADLAMP), s.look)
        assertEquals(start + 30_000, s.openedAtMillis)
        assertTrue(s.sharedBack)
    }

    @Test
    fun withoutASnapshotTheShareStillSaysWhatItCan() {
        val s = EndedViewModel.present(ShareState.Ended(share.copy(viewerName = null), ShareEnd(EndReason.TIMER, start + 30 * 60_000, confirmed = false), null))
        assertTrue(s.ended)
        assertEquals(Audience.None, s.audience)
        assertEquals(MascotLook(), s.look)
        assertEquals(share.startedAtMillis, s.startedAtMillis)
        assertNull(s.openedAtMillis)
        assertFalse(s.sharedBack)
    }

    @Test
    fun anythingButEndedShowsNothing() {
        assertFalse(EndedViewModel.present(ShareState.Idle).ended)
        assertFalse(EndedViewModel.present(ShareState.Live(share, session, UploadStatus.Initial)).ended)
    }
}
