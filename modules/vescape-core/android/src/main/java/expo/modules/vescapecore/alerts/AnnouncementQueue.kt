package expo.modules.vescapecore.alerts

import expo.modules.vescapecore.RideHazardCues

/**
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `AnnouncementPriority`
 */
enum class AnnouncementPriority(val ttlMs: Long) {
    CONNECTION(10_000L),
    ADVISORY(30_000L),
    SOCIAL(20_000L),
}

/**
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `appCuePriority`
 */
internal fun appCuePriority(cue: String): AnnouncementPriority? = when {
    appCueSlot(cue) == null -> null
    cue == "on" || cue == "off" || cue == "error" -> AnnouncementPriority.CONNECTION
    cue == "ride.end" || isSafetyCue(cue) -> AnnouncementPriority.ADVISORY
    else -> AnnouncementPriority.SOCIAL
}

/**
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `isSafetyCue`
 */
internal fun isSafetyCue(cue: String): Boolean =
    cue.startsWith("groupRide.signal.") || cue.startsWith(RideHazardCues.CUE_PREFIX)

/**
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `appCueSpeaks`
 */
internal fun appCueSpeaks(cue: String, voiceLevel: String): Boolean =
    if (isSafetyCue(cue)) voiceLevel != "off" else voiceLevel == "full"

/**
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `announcementSettleMs`
 */
internal const val ANNOUNCEMENT_SETTLE_MS = 4_000L

/**
 * @parity /modules/vescape-core/ios/alerts/AnnouncementQueue.swift `announcementQuietGapMs`
 */
internal const val ANNOUNCEMENT_QUIET_GAP_MS = 2_000L

internal sealed interface AnnouncementStep<out T> {
    data class Play<T>(val item: T) : AnnouncementStep<T>
    data class WaitUntil(val at: Long) : AnnouncementStep<Nothing>
    data object Idle : AnnouncementStep<Nothing>
}

/**
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

    val playing: T? get() = current?.item

    fun enqueue(item: T, priority: AnnouncementPriority, now: Long, ttlMs: Long = priority.ttlMs) {
        pending += Entry(item, priority, now + ttlMs, seq++)
    }

    fun connected(now: Long) {
        settleUntil = now + settleMs
    }

    fun criticalStarted(): T? {
        critical++
        return current?.let { it.preempted = true; it.item }
    }

    fun criticalEnded(now: Long) {
        if (critical == 0) return
        critical--
        if (critical == 0) quietUntil = now + quietGapMs
    }

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

    fun clear(): List<T> {
        val all = listOfNotNull(current?.item) + pending.map { it.item }
        pending.clear()
        current = null
        settleUntil = Long.MIN_VALUE
        return all
    }
}
