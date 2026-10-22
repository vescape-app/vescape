package expo.modules.vescapecore.alerts

/**
 * Rank of a queued announcement; the queue plays the lowest ordinal first, oldest first within one.
 * [ttlMs] is how long an item may wait before it is dropped as stale.
 *
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `AnnouncementPriority`
 */
enum class AnnouncementPriority(val ttlMs: Long) {
    /** Board connect, disconnect, connection error. */
    CONNECTION(10_000L),
    /** Ride state and, later, weather and battery lines. */
    ADVISORY(30_000L),
    /** Group Ride events. */
    SOCIAL(20_000L),
}

/**
 * Announcement Queue rank of app cue [cue]; null for an unknown cue.
 *
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `appCuePriority`
 */
internal fun appCuePriority(cue: String): AnnouncementPriority? = when {
    appCueSlot(cue) == null -> null
    cue == "on" || cue == "off" || cue == "error" -> AnnouncementPriority.CONNECTION
    cue == "ride.end" -> AnnouncementPriority.ADVISORY
    else -> AnnouncementPriority.SOCIAL
}

/**
 * Quiet time after a connect before anything but a [AnnouncementPriority.CONNECTION] item plays.
 *
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `announcementSettleMs`
 */
internal const val ANNOUNCEMENT_SETTLE_MS = 4_000L

/**
 * Gap after the last critical alert sound or line ends before the queue resumes.
 *
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `announcementQuietGapMs`
 */
internal const val ANNOUNCEMENT_QUIET_GAP_MS = 2_000L

/** What the queue's host should do next. */
internal sealed interface AnnouncementStep<out T> {
    data class Play<T>(val item: T) : AnnouncementStep<T>
    /** Nothing may play before [at]; ask again then. */
    data class WaitUntil(val at: Long) : AnnouncementStep<Nothing>
    data object Idle : AnnouncementStep<Nothing>
}

/**
 * The Announcement Queue's pure core: orders non-critical announcements and decides when the next
 * may play. Clock-injected (every call takes `now`) and single-threaded; the host confines it to its
 * audio thread and does the playing.
 *
 * - One item at a time: the next plays only after the host reports [finished].
 * - Critical alert audio ([criticalStarted] / [criticalEnded]) holds the queue, then a
 *   [quietGapMs] gap. The item it pre-empted is played again once, unless it expired meanwhile.
 * - [connected] opens a [settleMs] window only connection items play in.
 * - An item past its expiry is dropped, never played late.
 *
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `AnnouncementQueue`
 */
internal class AnnouncementQueue<T>(
    private val settleMs: Long = ANNOUNCEMENT_SETTLE_MS,
    private val quietGapMs: Long = ANNOUNCEMENT_QUIET_GAP_MS,
) {
    private class Entry<T>(
        val item: T,
        val priority: AnnouncementPriority,
        val expiresAt: Long,
        val seq: Long,
        var requeued: Boolean = false,
        var preempted: Boolean = false,
    )

    private val pending = ArrayList<Entry<T>>()
    private var current: Entry<T>? = null
    private var seq = 0L
    private var critical = 0
    private var settleUntil = Long.MIN_VALUE
    private var quietUntil = Long.MIN_VALUE

    /** The item playing now, if any. */
    val playing: T? get() = current?.item

    fun enqueue(item: T, priority: AnnouncementPriority, now: Long, ttlMs: Long = priority.ttlMs) {
        pending += Entry(item, priority, now + ttlMs, seq++)
    }

    fun connected(now: Long) {
        settleUntil = now + settleMs
    }

    /**
     * Critical alert audio started. Returns the queued item playing now, which the host must stop
     * and report [finished] as [PlaybackOutcome.CANCELLED].
     */
    fun criticalStarted(): T? {
        critical++
        return current?.let { it.preempted = true; it.item }
    }

    fun criticalEnded(now: Long) {
        if (critical == 0) return
        critical--
        if (critical == 0) quietUntil = now + quietGapMs
    }

    /**
     * The playing item ended with [outcome]. Returns it when that outcome is final, or null when it
     * was pre-empted and goes back in line.
     */
    fun finished(outcome: PlaybackOutcome, now: Long): T? {
        val entry = current ?: return null
        current = null
        if (outcome == PlaybackOutcome.CANCELLED && entry.preempted && !entry.requeued && entry.expiresAt > now) {
            entry.requeued = true
            entry.preempted = false
            pending += entry
            return null
        }
        return entry.item
    }

    /** Next step at [now]; expired items go to [onDrop] on the way. */
    fun next(now: Long, onDrop: (T) -> Unit): AnnouncementStep<T> {
        val expired = pending.filter { it.expiresAt <= now }
        pending.removeAll(expired)
        expired.forEach { onDrop(it.item) }
        if (current != null || critical > 0) return AnnouncementStep.Idle
        val head = pending.minWithOrNull(compareBy<Entry<T>>({ it.priority.ordinal }, { it.seq }))
            ?: return AnnouncementStep.Idle
        val settling = head.priority != AnnouncementPriority.CONNECTION && now < settleUntil
        val blockedUntil = maxOf(quietUntil, if (settling) settleUntil else Long.MIN_VALUE)
        if (now < blockedUntil) return AnnouncementStep.WaitUntil(minOf(blockedUntil, pending.minOf { it.expiresAt }))
        pending.remove(head)
        current = head
        return AnnouncementStep.Play(head.item)
    }

    /** Drop everything, the playing item included; returns them so the host can stop and report each. */
    fun clear(): List<T> {
        val all = listOfNotNull(current?.item) + pending.map { it.item }
        pending.clear()
        current = null
        settleUntil = Long.MIN_VALUE
        return all
    }
}
