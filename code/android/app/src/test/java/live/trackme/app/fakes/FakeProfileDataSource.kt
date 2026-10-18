package live.trackme.app.fakes

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import live.trackme.app.data.profile.Profile
import live.trackme.app.data.profile.ProfileDataException
import live.trackme.app.data.profile.ProfileDataSource
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.RemoteProfile

/**
 * users/{uid} in memory. Saves don't reach the live listener by themselves, like the real callable and
 * listener: call [deliver] to play the listener catching up.
 */
class FakeProfileDataSource(initial: RemoteProfile = RemoteProfile.Missing) : ProfileDataSource {
    val live = MutableStateFlow(initial)
    val saves = mutableListOf<Pair<Profile, Boolean>>()
    var stored: Profile? = (initial as? RemoteProfile.Present)?.profile

    /** The next save (or fetch) fails with this. */
    var failNext: ProfileFailure? = null
    var failFetch: ProfileFailure? = null

    /** When set, save waits for it before answering. */
    var saveGate: CompletableDeferred<Unit>? = null
    private var clock = 1_000L

    /** Each listener start takes the next scripted failure, if any: it fails at once and ends. */
    val listenerFailures = ArrayDeque<ProfileFailure>()
    var listenerStarts = 0

    override fun observe(uid: String): Flow<RemoteProfile> = flow {
        listenerStarts++
        val failure = listenerFailures.removeFirstOrNull()
        if (failure != null) emit(RemoteProfile.Failed(failure)) else emitAll(live)
    }

    override suspend fun fetch(uid: String): Profile? {
        failFetch?.let {
            failFetch = null
            throw ProfileDataException(it)
        }
        return stored
    }

    override suspend fun save(profile: Profile, includeSettings: Boolean): Profile {
        saves += profile to includeSettings
        saveGate?.await()
        failNext?.let {
            failNext = null
            throw ProfileDataException(it)
        }
        clock += 1_000
        val saved = profile.copy(
            name = profile.name.trim(),
            settings = if (includeSettings) profile.settings else stored?.settings ?: profile.settings,
            updatedAtMillis = clock,
        )
        stored = saved
        return saved
    }

    /** The listener delivers what's stored. */
    fun deliver() {
        live.value = stored?.let { RemoteProfile.Present(it) } ?: RemoteProfile.Missing
    }
}
