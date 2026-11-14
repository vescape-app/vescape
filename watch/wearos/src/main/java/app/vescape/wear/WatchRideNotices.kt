package app.vescape.wear

import expo.modules.vescapecore.watch.RideNoticeFrame
import expo.modules.vescapecore.watch.RideNoticeFrameItem

/**
 * The wrist's view of the phone's Ride Notices: which one the card shows, and when a notice is new
 * enough to buzz. `(id, rev)` is the identity: a pair this app run has not shown yet buzzes, the
 * same pair updated in place does not, and a new `rev` or a reused id buzzes again.
 *
 * A tap hides the card on the wrist only ([hide]); the hide lasts until the notice leaves the list
 * or its `rev` changes. Expiry runs on the watch's own wall clock, so a phone that died without
 * clearing its list cannot leave a notice on the wrist past its `expiresAt`.
 *
 * @parity /modules/vescape-core/ios/watch/WatchRideNotices.swift `WatchRideNotices`
 */
internal class WatchRideNotices {
    /** Visible, unexpired notices, most urgent first. */
    var notices: List<RideNoticeFrameItem> = emptyList()
        private set
    private var sentAtMs: Long? = null
    /** `rev` already shown per id since app start. */
    private val shown = HashMap<Int, Int>()
    /** `rev` the rider hid per id. */
    private val hidden = HashMap<Int, Int>()

    /** The notice the full-screen card shows, or null for the gauges. */
    val card: RideNoticeFrameItem? get() = notices.firstOrNull { hidden[it.id] != it.rev }

    /**
     * Take a phone frame. True when it brings a pair not yet shown, i.e. the wrist should buzz. A
     * frame no newer than the one held is a repeat (a startup read of the item a listener already
     * delivered) or a late delivery of a list already replaced, and is ignored.
     */
    fun accept(frame: RideNoticeFrame, nowMs: Long): Boolean {
        sentAtMs?.let { if (frame.sentAtMs <= it) return false }
        sentAtMs = frame.sentAtMs
        notices = frame.notices
        return prune(nowMs)
    }

    /** The channel is gone: nothing to show, nothing remembered. */
    fun clear() {
        notices = emptyList()
        prune(0)
    }

    fun hide(id: Int, rev: Int) {
        if (notices.any { it.id == id && it.rev == rev }) hidden[id] = rev
    }

    /** Drop expired notices and forget hides and shown pairs no longer in the list. True on a new pair. */
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
