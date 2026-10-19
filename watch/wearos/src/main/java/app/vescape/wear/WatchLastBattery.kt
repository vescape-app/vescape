package app.vescape.wear

import androidx.compose.runtime.mutableStateOf

const val LAST_BATTERY_PATH = "/last-battery"

/**
 * @parity /modules/vescape-core/ios/watch/WatchLastBattery.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchLastBattery.kt
 */
data class WatchLastBattery(val boardId: String, val boardName: String, val percent: Double?, val at: Long?) {
    val text: String get() = percent?.let(::batteryPercent) ?: "--"
    /** @parity /src/modules/board/components/BatteryIndicator.tsx */
    fun age(now: Long): String? {
        if (at == null || percent == null) return null
        val hours = maxOf(0, now - at) / 3_600_000
        return when { hours < 1 -> null; hours < 24 -> "${hours}h"; else -> "${hours / 24}d" }
    }
    fun ageLabel(now: Long): String? = age(now)?.let { "$it ago" }
    fun updateKey(now: Long) = "$boardId:$boardName:$text:${age(now)}"
    companion object {
        fun decode(payload: Map<String, Any?>?): WatchLastBattery? {
            val id = payload?.get("boardId") as? String ?: return null
            val name = payload["boardName"] as? String ?: return null
            if (id.isEmpty()) return null
            val percent = (payload["percent"] as? Number)?.toDouble()
            val at = (payload["at"] as? Number)?.toLong()
            val known = percent != null && percent.isFinite() && percent in 0.0..100.0 && at != null
            return WatchLastBattery(id, name, percent.takeIf { known }, at.takeIf { known })
        }
    }
}
object LastBatteryState {
    val battery = mutableStateOf<WatchLastBattery?>(null)
}

/**
 * Stores only a notification fingerprint, never a second copy of durable watch data.
 * @parity /modules/vescape-core/ios/watch/WatchBatteryWakeGate.swift
 */
internal class BatteryUpdateGate {
    private var previous: String? = null
    fun changed(value: WatchLastBattery?, now: Long): Boolean {
        val next = value?.updateKey(now) ?: "clear"
        if (previous == next) return false
        previous = next
        return true
    }
}
