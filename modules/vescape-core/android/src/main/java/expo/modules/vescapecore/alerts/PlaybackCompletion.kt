package expo.modules.vescapecore.alerts

import java.util.concurrent.atomic.AtomicReference

/**
 * @parity /modules/vescape-core/ios/alerts/PlaybackCompletion.swift `PlaybackOutcome`
 */
enum class PlaybackOutcome { COMPLETED, CANCELLED, FAILED }

typealias PlaybackDone = (PlaybackOutcome) -> Unit

/**
 * @parity /modules/vescape-core/ios/alerts/PlaybackCompletion.swift `playbackDoneTimeoutMs`
 */
internal const val PLAYBACK_DONE_TIMEOUT_MS = 30_000L

/**
 * @parity /modules/vescape-core/ios/alerts/PlaybackCompletion.swift `PlaybackCompletion`
 */
internal class PlaybackCompletion(
    private val deliver: (() -> Unit) -> Unit,
    onDone: PlaybackDone,
) {
    private val pending = AtomicReference<PlaybackDone?>(onDone)

    val isDone: Boolean get() = pending.get() == null

    fun finish(outcome: PlaybackOutcome): Boolean {
        val done = pending.getAndSet(null) ?: return false
        deliver { done(outcome) }
        return true
    }
}

/**
 * @parity /modules/vescape-core/ios/alerts/PlaybackCompletion.swift `PlaybackTracker`
 */
internal class PlaybackTracker(private val deliver: (() -> Unit) -> Unit) {
    private val live = LinkedHashSet<PlaybackCompletion>()
    private var speech: PlaybackCompletion? = null

    fun start(onDone: PlaybackDone): PlaybackCompletion {
        lateinit var completion: PlaybackCompletion
        completion = PlaybackCompletion(deliver) { outcome -> live.remove(completion); onDone(outcome) }
        live.add(completion)
        return completion
    }

    fun claimSpeech(completion: PlaybackCompletion) {
        speech?.takeIf { it !== completion }?.finish(PlaybackOutcome.CANCELLED)
        speech = completion
    }

    fun isSpeech(completion: PlaybackCompletion): Boolean = speech === completion && !completion.isDone

    fun cancelAll() {
        speech = null
        for (completion in live.toList()) completion.finish(PlaybackOutcome.CANCELLED)
    }
}
