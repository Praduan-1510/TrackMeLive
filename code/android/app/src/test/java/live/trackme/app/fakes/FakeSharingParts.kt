package live.trackme.app.fakes

import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import live.trackme.app.data.sharing.ActiveShare
import live.trackme.app.data.sharing.ForegroundStartRefused
import live.trackme.app.data.sharing.PingUploader
import live.trackme.app.data.sharing.SessionView
import live.trackme.app.data.sharing.ShareStore
import live.trackme.app.data.sharing.SharingServiceController
import live.trackme.app.data.sharing.StoredShare
import live.trackme.app.data.sharing.UploadStatus

/**
 * A [PingUploader] that runs until cancelled and records it; its [status] is settable. [running] counts
 * runs whose job is still active, so a cancel shows at once, as it does for the real uploader (a
 * cancelled run can't write again).
 */
class FakePingUploader : PingUploader {
    override val status = MutableStateFlow(UploadStatus.Initial)
    val runs = mutableListOf<ActiveShare>()
    private val jobs = mutableListOf<Job>()
    val running: Int get() = jobs.count { it.isActive }
    var lastSession: StateFlow<SessionView?>? = null
        private set

    override suspend fun run(share: ActiveShare, session: StateFlow<SessionView?>) {
        runs += share
        lastSession = session
        jobs += currentCoroutineContext()[Job]!!
        awaitCancellation()
    }
}

/** A [SharingServiceController] that records starts and stops; [refuse] makes start fail as Android 12+ would from the background. */
class FakeServiceController : SharingServiceController {
    override var isRunning = false
        private set
    var starts = 0
        private set
    var stops = 0
        private set
    var refuse = false

    override fun start() {
        if (refuse) throw ForegroundStartRefused()
        starts++
        isRunning = true
    }

    override fun stop() {
        stops++
        isRunning = false
    }
}

/** A [ShareStore] in memory, with a boot of its own. */
class FakeShareStore(var stored: StoredShare? = null, var offset: Long? = null) : ShareStore {
    override fun load(): StoredShare? = stored

    override fun save(stored: StoredShare) {
        this.stored = stored
    }

    override fun clear() {
        stored = null
    }

    override fun loadClockOffset(): Long? = offset

    override fun saveClockOffset(offsetMillis: Long) {
        offset = offsetMillis
    }
}
