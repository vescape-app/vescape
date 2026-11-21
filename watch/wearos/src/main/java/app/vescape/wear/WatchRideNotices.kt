package app.vescape.wear

import expo.modules.vescapecore.watch.RideNoticeFrame
import expo.modules.vescapecore.watch.RideNoticeFrameItem

/**
 * @parity /modules/vescape-core/ios/watch/WatchRideNotices.swift `WatchRideNotices`
 */
internal class WatchRideNotices {
    var notices: List<RideNoticeFrameItem> = emptyList()
        private set
    private var sentAtMs: Long? = null
    private val shown = HashMap<Int, Int>()
    private val hidden = HashMap<Int, Int>()

    val card: RideNoticeFrameItem? get() = notices.firstOrNull { hidden[it.id] != it.rev }

    fun accept(frame: RideNoticeFrame, nowMs: Long): Boolean {
        sentAtMs?.let { if (frame.sentAtMs <= it) return false }
        sentAtMs = frame.sentAtMs
        notices = frame.notices
        return prune(nowMs)
    }

    fun clear() {
        notices = emptyList()
        prune(0)
    }

    fun hide(id: Int, rev: Int) {
        if (notices.any { it.id == id && it.rev == rev }) hidden[id] = rev
    }

    fun prune(nowMs: Long): Boolean {
        notices = notices.filter { notice -> notice.expiresAtMs?.let { it > nowMs } != false }
        val revs = notices.associate { it.id to it.rev }
        hidden.entries.removeAll { (id, rev) -> revs[id] != rev }
        shown.entries.removeAll { (id, rev) -> revs[id] != rev }
        val fresh = notices.any { shown[it.id] != it.rev }
        shown.putAll(revs)
        return fresh
    }
}
