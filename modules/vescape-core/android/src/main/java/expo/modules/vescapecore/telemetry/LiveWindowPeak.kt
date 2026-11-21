package expo.modules.vescapecore.telemetry

/**
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
