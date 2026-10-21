package expo.modules.vescapecore.watch

internal const val WATCH_LAST_BATTERY_PATH = "/last-battery"

/**
 * `percent` and `at` are both set or both null; null keys are omitted. A deleted item clears the
 * selected board.
 * @parity /modules/vescape-core/ios/watch/WatchLastBattery.swift
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchLastBattery.kt
 */
internal data class WatchLastBattery(val boardId: String, val boardName: String, val percent: Double?, val at: Long?) {
    companion object {
        /**
         * The selected Board as `AppDataRepository.getBoard` returns it; null without a live selection.
         * @parity /modules/vescape-core/ios/watch/WatchLastBattery.swift `selected`
         */
        fun selected(boardId: String?, board: Map<String, Any?>?): WatchLastBattery? {
            if (boardId == null || board == null || board["deletedAt"] != null) return null
            val stored = board["lastBattery"] as? Map<*, *>
            val percent = (stored?.get("percent") as? Number)?.toDouble()?.takeIf { it.isFinite() }
            val at = (stored?.get("at") as? Number)?.toLong()
            val known = percent != null && at != null
            return WatchLastBattery(
                boardId,
                board["name"] as? String ?: "Board",
                percent.takeIf { known },
                at.takeIf { known },
            )
        }
    }
}
