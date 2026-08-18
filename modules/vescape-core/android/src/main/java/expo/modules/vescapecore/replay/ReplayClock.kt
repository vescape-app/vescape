package expo.modules.vescapecore.replay

import expo.modules.vescapecore.runtime.SessionClock

/**
 * The [SessionClock] a replay runs on: session time that advances at [warmupSpeed] × real time
 * until the recording leaves the warmup window, then at 1× for the rest of playback.
 *
 * A replay may open with its live window already filled rather than spending real minutes earning
 * one. Dispatching the recording faster is not enough on its own: live series bucket each sample by
 * the timestamp it carries, across a window measured in minutes, so a six-minute warmup delivered
 * in twelve seconds would land as twelve seconds of samples — a sliver, not a filled window. Running
 * session time fast stamps those samples across the six minutes they actually cover, and the
 * window is genuinely full the moment the warmup ends.
 *
 * The clock starts one warmup window in the past, so session time reaches "now" exactly as the
 * warmup finishes. Playback then continues at 1×, permanently trailing wall time by however long
 * the warmup took to play (`warmupMs / warmupSpeed`). That constant lag is what keeps the timeline
 * continuous — snapping it back to zero would tear a gap into every series at the boundary.
 *
 * With [warmupMs] `0` — the default, and what the dev Replay UI uses — [speed] is never anything but
 * 1.0 and this clock reads exactly like wall time.
 *
 * @parity /modules/vescape-core/ios/replay/ReplayClock.swift
 */
internal class ReplayClock(
    private val warmupMs: Long = 0L,
    private val warmupSpeed: Double = 1.0,
) : SessionClock {
    /**
     * Read from the BLE dispatch thread, the main thread and the scheduler, so every read has to see
     * one consistent anchor set rather than a half-updated one.
     */
    private val lock = Any()
    private var currentSpeed = 1.0
    private var anchorWallMs = System.currentTimeMillis()
    private var anchorSessionMs = anchorWallMs - warmupMs

    /** Session time of recorded offset `0`; fixed when playback actually begins. */
    private var originSessionMs = anchorSessionMs

    override val speed: Double
        get() = synchronized(lock) { currentSpeed }

    override fun nowMs(): Long = synchronized(lock) { sessionAt(System.currentTimeMillis()) }

    /**
     * Session time never runs past the end of the warmup window while it is still running fast: the
     * transport only notices the boundary on its next scheduling call, and without the clamp the
     * clock would sail an arbitrary distance past it in the meantime — stamping samples beyond the
     * window the warmup was asked to cover, by an amount that depends on when it happened to be
     * read. Clamped, the handover lands on exactly `warmupMs` however late the check arrives.
     */
    private fun sessionAt(wallMs: Long): Long {
        val elapsed = anchorSessionMs + ((wallMs - anchorWallMs) * currentSpeed).toLong()
        return if (currentSpeed == 1.0) elapsed else minOf(elapsed, originSessionMs + warmupMs)
    }

    /**
     * Re-anchor to the moment the first event is dispatched and hand the clock its warmup speed.
     *
     * Decoding a megabyte recording happens between construction and here, so the clock deliberately
     * idles at 1× until this call — a clock already running at 30× would race through minutes of
     * session time while the file was still being parsed. Because the pre-playback anchor is also
     * `wall - warmupMs` at 1×, re-anchoring here cannot move session time; it only changes how fast
     * it runs from now on.
     */
    fun startPlayback(wallMs: Long) = synchronized(lock) {
        anchorWallMs = wallMs
        anchorSessionMs = wallMs - warmupMs
        originSessionMs = anchorSessionMs
        currentSpeed = if (warmupMs > 0L) warmupSpeed else 1.0
    }

    /**
     * Wall milliseconds to wait before the recording reaches [recordedT].
     *
     * The drop to 1× happens once session time has *reached* the end of the warmup window, not when
     * an event past it is first scheduled: the event that lands on the boundary is still part of the
     * warmup and has to be paced at warmup speed, or the clock would spend a full real warmup window
     * sleeping its way to it. Session time is continuous across the change — the new anchor is the
     * session time the old speed had just produced.
     */
    fun delayUntilRecorded(recordedT: Long): Long = synchronized(lock) {
        val wallMs = System.currentTimeMillis()
        if (currentSpeed != 1.0 && sessionAt(wallMs) >= originSessionMs + warmupMs) {
            anchorSessionMs = sessionAt(wallMs)
            anchorWallMs = wallMs
            currentSpeed = 1.0
        }
        val remainingSessionMs = originSessionMs + recordedT - sessionAt(wallMs)
        if (remainingSessionMs <= 0L) 0L else (remainingSessionMs / currentSpeed).toLong()
    }
}
