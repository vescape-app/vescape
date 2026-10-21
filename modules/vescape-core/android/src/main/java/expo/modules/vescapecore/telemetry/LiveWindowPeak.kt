package expo.modules.vescapecore.telemetry

/**
 * Highest value of one metric across the live window, kept current per packet without rescanning
 * the window: a new sample can only raise it, so the window is rescanned only when the peak sample
 * rolls off or the sanitizer re-labels past samples. Not thread-safe; the owner's lock guards it.
 *
 * @parity /modules/vescape-core/ios/telemetry/LiveWindowPeak.swift
 */
internal class LiveWindowPeak(private val select: (Map<String, Any?>) -> Double?) {
    private var peak: Double? = null
    private var stale = false

    fun add(row: Map<String, Any?>) {
        if (stale) return
        val value = select(row) ?: return
        if (peak.let { it == null || value > it }) peak = value
    }

    /** [row] left the window; the peak needs a rescan only if it was the peak sample. */
    fun evict(row: Map<String, Any?>) {
        if (!stale && peak != null && select(row) == peak) stale = true
    }

    fun invalidate() {
        stale = true
    }

    fun reset() {
        peak = null
        stale = false
    }

    fun value(window: Collection<Map<String, Any?>>): Double? {
        if (stale) {
            peak = window.mapNotNull(select).maxOrNull()
            stale = false
        }
        return peak
    }
}
