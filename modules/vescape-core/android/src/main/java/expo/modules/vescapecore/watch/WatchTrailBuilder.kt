package expo.modules.vescapecore.watch

/** The main map's native recent precise fixes, sampled to a bounded wrist snapshot. No watch history.
 * @parity /modules/vescape-core/ios/watch/WatchTrail.swift `watchTrail`
 */
internal fun watchTrail(rider: GeoPoint?, history: List<Map<String, Any?>>): List<WatchTrailPoint> {
    if (rider == null) return emptyList()
    val fixes = history.mapNotNull { row ->
        val lat = (row["latitude"] as? Number)?.toDouble() ?: return@mapNotNull null
        val lon = (row["longitude"] as? Number)?.toDouble() ?: return@mapNotNull null
        if (!lat.isFinite() || !lon.isFinite()) null else GeoPoint(lat, lon)
    }
    if (fixes.isEmpty()) return emptyList()
    val count = minOf(fixes.size, WatchTrailCodec.MAX_POINTS)
    return List(count) { i ->
        val index = if (count == 1) 0 else i * (fixes.size - 1) / (count - 1)
        val (east, north) = offsetMeters(rider, fixes[index])
        WatchTrailPoint(east, north)
    }
}
