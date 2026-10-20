package expo.modules.vescapecore.watch

/**
 * Optional values are omitted. An empty payload clears the selected board.
 * @parity /modules/vescape-core/ios/watch/WatchLastBattery.swift
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchLastBattery.kt
 */
internal data class WatchLastBattery(val boardId: String, val boardName: String, val percent: Double?, val at: Long?) {
    fun payload(): Map<String, Any> = buildMap {
        put("boardId", boardId)
        put("boardName", boardName)
        if (percent != null && percent.isFinite() && at != null) {
            put("percent", percent)
            put("at", at)
        }
    }
}
