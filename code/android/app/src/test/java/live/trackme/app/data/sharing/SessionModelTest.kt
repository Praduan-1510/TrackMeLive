package live.trackme.app.data.sharing

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.functions.FirebaseFunctionsException
import live.trackme.app.fakes.FakeSharingRepository
import live.trackme.schema.EndReason
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId
import live.trackme.schema.Precision
import live.trackme.schema.StopMinutes
import live.trackme.schema.StopRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

class SessionViewTest {
    private val start = FakeSharingRepository.START_MILLIS
    private val share = FakeSharingRepository.shareFor(ShareRequest(StopChoice.AtLimit, Precision.PRECISE, false), startedAt = start)
    private fun view(stop: StopChoice) = FakeSharingRepository.sessionFor(share, ShareRequest(stop, Precision.PRECISE, false))
    private val hour = 3_600_000L

    @Test
    fun `live until the earlier of stop_at and expires_at`() {
        val timer = view(StopChoice.After(StopMinutes.MINUTES_15))
        assertEquals(start + 15 * 60_000L, timer.endsAtMillis)
        assertNull(timer.endAt(start + 15 * 60_000L - 1))
        assertEquals(ShareEnd(EndReason.TIMER, start + 15 * 60_000L, confirmed = false), timer.endAt(start + 15 * 60_000L))
    }

    @Test
    fun `the limit, or a stop_at equal to it, ends as limit`() {
        assertEquals(EndReason.LIMIT, view(StopChoice.AtLimit).endAt(start + hour)?.reason)
        assertEquals(EndReason.LIMIT, view(StopChoice.After(StopMinutes.MINUTES_60)).endAt(start + hour)?.reason)
        // The call rule has no stop_at: only the limit.
        assertEquals(start + hour, view(StopChoice.WhenCallEnds).endsAtMillis)
    }

    @Test
    fun `the server's recorded end wins, at any time`() {
        val stopped = view(StopChoice.AtLimit).copy(active = false, endReason = EndReason.STOPPED, endedAtMillis = start + 60_000)
        assertEquals(ShareEnd(EndReason.STOPPED, start + 60_000, confirmed = true), stopped.endAt(start))
        assertEquals(ShareEnd(EndReason.STOPPED, start + 60_000, confirmed = true), stopped.endAt(null))
    }

    @Test
    fun `without server time only the recorded end counts`() {
        assertNull(view(StopChoice.After(StopMinutes.MINUTES_15)).endAt(null))
        assertFalse(view(StopChoice.AtLimit).limitSoon(null))
    }

    @Test
    fun `the 1-hour warning shows from 5 minutes before the limit, only when the limit ends it`() {
        val limit = view(StopChoice.AtLimit)
        assertFalse(limit.limitSoon(start + 55 * 60_000L - 1))
        assertTrue(limit.limitSoon(start + 55 * 60_000L))
        assertFalse(limit.limitSoon(start + hour))
        assertTrue(view(StopChoice.WhenCallEnds).limitSoon(start + 56 * 60_000L))
        assertFalse(view(StopChoice.After(StopMinutes.MINUTES_30)).limitSoon(start + 56 * 60_000L))
    }

    @Test
    fun `a pending precision is the one the next ping uses`() {
        assertEquals(Precision.APPROXIMATE, view(StopChoice.AtLimit).copy(precisionNext = Precision.APPROXIMATE).effectivePrecision)
        assertEquals(Precision.PRECISE, view(StopChoice.AtLimit).effectivePrecision)
    }
}

class SessionParsingTest {
    private fun ts(millis: Long) = FirestoreSessionDataSource.timestampOf(millis)

    private val doc = mapOf<String, Any?>(
        "status" to "active",
        "started_at" to ts(1_000_000),
        "expires_at" to ts(4_600_000),
        "stop_rule" to "minutes",
        // On the wire stop_minutes is a number, which Firestore's mapper can't read into an enum.
        "stop_minutes" to 30L,
        "stop_at" to ts(2_800_000),
        "ended_at" to null,
        "end_reason" to null,
        "call_id" to null,
        "call_active" to false,
        "call_ended_at" to null,
        "share_back_allowed" to false,
        "last_ping_at" to ts(1_000_000),
        "ping_interval_s" to 5L,
        "precision" to "approximate",
        "precision_next" to "precise",
        "sharer" to mapOf("name" to "Alex", "mascot_id" to "neko", "mascot_color" to "dusk", "mascot_accessory" to "glasses"),
        "first_viewed_at" to ts(1_200_345),
        "viewer_sharing" to false,
        "share_back_requested_at" to null,
        "cleaned_at" to null,
        "last_fix_at" to ts(1_100_000),
    )

    @Test
    fun `a session doc reads whole`() {
        val view = sessionViewOf(doc)
        assertTrue(view.active)
        assertEquals(StopRule.MINUTES, view.stopRule)
        assertEquals(StopMinutes.MINUTES_30, view.stopMinutes)
        assertEquals(2_800_000L, view.stopAtMillis)
        assertEquals(5.0, view.pingIntervalSeconds, 0.0)
        assertEquals(Precision.APPROXIMATE, view.precision)
        assertEquals(Precision.PRECISE, view.precisionNext)
        assertEquals(1_200_345L, view.firstViewedAtMillis)
        assertEquals(1_100_000L, view.lastFixAtMillis)
        assertEquals("Alex", view.sharer.name)
        assertEquals(MascotId.NEKO, view.sharer.mascotId)
        assertEquals(MascotColor.DUSK, view.sharer.mascotColor)
        assertEquals(MascotAccessory.GLASSES, view.sharer.mascotAccessory)
    }

    @Test
    fun `an ended session reads its end, and an older doc without last_fix_at reads null`() {
        val view = sessionViewOf(
            doc + mapOf("status" to "stopped", "end_reason" to "timer", "ended_at" to ts(2_800_000), "ping_interval_s" to 3.5) - "last_fix_at",
        )
        assertFalse(view.active)
        assertEquals(EndReason.TIMER, view.endReason)
        assertEquals(2_800_000L, view.endedAtMillis)
        assertEquals(3.5, view.pingIntervalSeconds, 0.0)
        assertNull(view.lastFixAtMillis)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `a doc missing a required field is refused`() {
        sessionViewOf(doc - "expires_at")
    }

    @Test(expected = ClassCastException::class)
    fun `a doc with a field of the wrong type is refused`() {
        sessionViewOf(doc + ("started_at" to "yesterday"))
    }

    @Test
    fun `timestamps keep millisecond precision both ways`() {
        val t: Timestamp = ts(1_792_273_080_123)
        assertEquals(1_792_273_080L, t.seconds)
        assertEquals(123_000_000, t.nanoseconds)
        assertEquals(Timestamp(-1, 999_000_000), ts(-1))
    }

    @Test
    fun `the stop rule for each choice`() {
        assertEquals(StopRule.CALL, StopChoice.WhenCallEnds.rule)
        assertEquals(StopRule.MINUTES, StopChoice.After(StopMinutes.MINUTES_15).rule)
        assertEquals(StopRule.LIMIT, StopChoice.AtLimit.rule)
    }
}

/** On Robolectric: the SDKs' error codes build Android maps when loaded. */
@RunWith(RobolectricTestRunner::class)
class SharingErrorsTest {
    // The SDK's constructors are Kotlin-internal (public in the bytecode), so tests build one through reflection.
    private fun functions(code: FirebaseFunctionsException.Code, details: Any? = null, cause: Throwable? = null): SharingDataException {
        val type = FirebaseFunctionsException::class.java
        val e = if (cause == null) {
            type.getConstructor(String::class.java, FirebaseFunctionsException.Code::class.java, Any::class.java).newInstance("x", code, details)
        } else {
            type.getConstructor(String::class.java, FirebaseFunctionsException.Code::class.java, Any::class.java, Throwable::class.java)
                .newInstance("x", code, details, cause)
        }
        return FirestoreSessionDataSource.functionsExceptionOf(e)
    }

    @Test
    fun `callable errors map to what the screens say`() {
        assertEquals(SharingFailure.SignInEnded, functions(FirebaseFunctionsException.Code.UNAUTHENTICATED).reason)
        assertEquals(SharingFailure.NotSignedIn, functions(FirebaseFunctionsException.Code.PERMISSION_DENIED).reason)
        assertEquals(SharingFailure.Invalid, functions(FirebaseFunctionsException.Code.INVALID_ARGUMENT).reason)
        assertEquals(SharingFailure.NotSharing, functions(FirebaseFunctionsException.Code.NOT_FOUND).reason)
        assertEquals(SharingFailure.Network, functions(FirebaseFunctionsException.Code.UNAVAILABLE).reason)
        assertEquals(SharingFailure.Network, functions(FirebaseFunctionsException.Code.DEADLINE_EXCEEDED).reason)
        // A dropped connection comes as INTERNAL caused by an IOException.
        assertEquals(SharingFailure.Network, functions(FirebaseFunctionsException.Code.INTERNAL, cause = java.io.IOException()).reason)
        assertEquals(SharingFailure.Other, functions(FirebaseFunctionsException.Code.INTERNAL).reason)
    }

    @Test
    fun `already sharing carries the running session's id`() {
        val e = functions(FirebaseFunctionsException.Code.ALREADY_EXISTS, mapOf("reason" to "active_session", "session_id" to "s-9"))
        assertEquals("s-9", e.activeSessionId)
    }

    @Test
    fun `failed preconditions read their reason`() {
        assertEquals(SharingFailure.NoProfile, functions(FirebaseFunctionsException.Code.FAILED_PRECONDITION, mapOf("reason" to "no_profile")).reason)
        assertTrue(functions(FirebaseFunctionsException.Code.FAILED_PRECONDITION, mapOf("reason" to "link_opened")).linkOpened)
        assertFalse(functions(FirebaseFunctionsException.Code.FAILED_PRECONDITION).linkOpened)
    }

    @Test
    fun `Firestore errors map too - a refused write means the share is over`() {
        fun firestore(code: FirebaseFirestoreException.Code) = FirestoreSessionDataSource.firestoreFailureOf(FirebaseFirestoreException("x", code))
        assertEquals(SharingFailure.NotSharing, firestore(FirebaseFirestoreException.Code.PERMISSION_DENIED))
        assertEquals(SharingFailure.NotSharing, firestore(FirebaseFirestoreException.Code.NOT_FOUND))
        assertEquals(SharingFailure.Network, firestore(FirebaseFirestoreException.Code.UNAVAILABLE))
        assertEquals(SharingFailure.SignInEnded, firestore(FirebaseFirestoreException.Code.UNAUTHENTICATED))
        assertEquals(SharingFailure.Other, firestore(FirebaseFirestoreException.Code.ABORTED))
    }
}
