package expo.modules.vescapecore.alerts

import java.util.concurrent.atomic.AtomicReference

/**
 * How one alert playback item ended.
 *
 * @parity /modules/vescape-core/ios/alerts/PlaybackCompletion.swift `PlaybackOutcome`
 */
enum class PlaybackOutcome { COMPLETED, CANCELLED, FAILED }

/** Told once how a playback item ended. [AlertFeedback] calls it on its audio looper. */
typealias PlaybackDone = (PlaybackOutcome) -> Unit

/**
 * Longest any playback item may take before it reports [PlaybackOutcome.FAILED], so a lost
 * completion (a SoundPool cue, a TTS engine that never calls back) never stalls the caller.
 *
 * @parity /modules/vescape-core/ios/alerts/PlaybackCompletion.swift `playbackDoneTimeoutMs`
 */
internal const val PLAYBACK_DONE_TIMEOUT_MS = 30_000L

/**
 * Exactly-once wrapper around [onDone]: the first [finish] wins and is delivered through
 * [deliver]; every later one, from any thread, is dropped.
 *
 * @parity /modules/vescape-core/ios/alerts/PlaybackCompletion.swift `PlaybackCompletion`
 */
internal class PlaybackCompletion(
    private val deliver: (() -> Unit) -> Unit,
    onDone: PlaybackDone,
) {
    private val pending = AtomicReference<PlaybackDone?>(onDone)

    val isDone: Boolean get() = pending.get() == null

    /** Report [outcome]; true when this call was the one that finished the item. */
    fun finish(outcome: PlaybackOutcome): Boolean {
        val done = pending.getAndSet(null) ?: return false
        deliver { done(outcome) }
        return true
    }
}

/**
 * Every unfinished playback item, and the one speech item (voice line or TTS) a newer one
 * pre-empts. Confined to the audio looper.
 *
 * @parity /modules/vescape-core/ios/alerts/PlaybackCompletion.swift `PlaybackTracker`
 */
internal class PlaybackTracker(private val deliver: (() -> Unit) -> Unit) {
    private val live = LinkedHashSet<PlaybackCompletion>()
    private var speech: PlaybackCompletion? = null

    /** A new tracked item; [cancelAll] reports it cancelled if still running. */
    fun start(onDone: PlaybackDone): PlaybackCompletion {
        lateinit var completion: PlaybackCompletion
        completion = PlaybackCompletion(deliver) { outcome -> live.remove(completion); onDone(outcome) }
        live.add(completion)
        return completion
    }

    /** Make [completion] the current speech item, cancelling the one it pre-empts. */
    fun claimSpeech(completion: PlaybackCompletion) {
        speech?.takeIf { it !== completion }?.finish(PlaybackOutcome.CANCELLED)
        speech = completion
    }

    fun cancelAll() {
        speech = null
        for (completion in live.toList()) completion.finish(PlaybackOutcome.CANCELLED)
    }
}
