package live.trackme.app.ui.ended

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.SharingRepository
import live.trackme.app.di.AppContainer
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.share.Audience
import live.trackme.schema.EndReason

/** The ended screen (prototype › viewEnded): why it ended and a short summary of the share. */
@Immutable
data class EndedUiState(
    /** False until there's an ended share to show. */
    val ended: Boolean = false,
    val reason: EndReason = EndReason.STOPPED,
    val audience: Audience = Audience.None,
    /** The mascot the share used. */
    val look: MascotLook = MascotLook(),
    val startedAtMillis: Long = 0,
    /** When it ended, server time (for a timer or the limit: when it was due). */
    val endedAtMillis: Long = 0,
    val openedAtMillis: Long? = null,
    val sharedBack: Boolean = false,
) {
    /** At the 1-hour limit, Share again (a new session with a new link) leads, and Done follows. */
    val offersShareAgain: Boolean get() = reason == EndReason.LIMIT
}

/**
 * The share is over (FSD §4 Auto-expiry, Stop sharing, 1-hour limit): stopped, the timer ran out, the
 * call ended, or the 1-hour limit. Done (or Share again) leaves it, through the app's navigation.
 */
class EndedViewModel(sharing: SharingRepository) : ViewModel() {
    val state: StateFlow<EndedUiState> = sharing.state.map(::present)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), present(sharing.state.value))

    companion object {
        fun present(share: ShareState): EndedUiState {
            val ended = share as? ShareState.Ended ?: return EndedUiState()
            val session = ended.session
            return EndedUiState(
                ended = true,
                reason = ended.end.reason,
                audience = Audience.of(ended.share.viewerName),
                look = session?.sharer?.let { MascotLook(it.mascotId, it.mascotColor, it.mascotAccessory).normalized() } ?: MascotLook(),
                startedAtMillis = session?.startedAtMillis ?: ended.share.startedAtMillis,
                endedAtMillis = ended.end.atMillis,
                openedAtMillis = session?.firstViewedAtMillis,
                sharedBack = session?.viewerSharing == true,
            )
        }

        fun factory(container: AppContainer) = viewModelFactory {
            initializer { EndedViewModel(container.sharing) }
        }
    }
}
