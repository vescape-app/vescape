package expo.modules.vescapecore.telemetry

import kotlin.math.cos
import org.json.JSONArray

/**
 * Derived thumbnail geometry. route_preview_v1 stores JSON segments [firstFixMs,lastFixMs,polyline],
 * with signed delta-varint polyline coordinates at E7 precision. NULL means not generated yet.
 * Always simplify original fixes, never an earlier preview. Endpoints survive every simplification.
 * @parity /modules/vescape-core/ios/telemetry/BucketRoutePreview.swift
 */
internal object BucketRoutePreview {
  const val GAP_MS = 30_000L
  private const val TOLERANCE_M = 5.0
  private const val METRES_PER_E7 = 6_371_000.0 * Math.PI / 180.0 / 10_000_000.0

  data class Coordinate(val latitudeE7: Long, val longitudeE7: Long)
  data class Segment(val firstAtMs: Long, val lastAtMs: Long, val points: List<Coordinate>)

  fun build(track: List<RideTrackPointEntity>): String {
    val segments = mutableListOf<MutableList<RideTrackPointEntity>>()
    for (point in track.filter { it.isPrecise() }.sortedBy { it.fixAtMs }) {
      val previous = segments.lastOrNull()?.lastOrNull()
      if (previous == null || point.fixAtMs - previous.fixAtMs > GAP_MS ||
        point.recordingId != previous.recordingId || point.boardId != previous.boardId) {
        segments.add(mutableListOf())
      }
      segments.last().add(point)
    }
    return JSONArray().apply {
      for (segment in segments) {
        val coordinates = segment.map { Coordinate(it.latitudeE7.toLong(), it.longitudeE7.toLong()) }
        put(JSONArray().put(segment.first().fixAtMs).put(segment.last().fixAtMs).put(encode(simplify(coordinates))))
      }
    }.toString()
  }

  fun decode(value: String): List<Segment> {
    val array = JSONArray(value)
    return (0 until array.length()).map { index ->
      val segment = array.getJSONArray(index)
      Segment(segment.getLong(0), segment.getLong(1), decodePolyline(segment.getString(2)))
    }
  }

  private fun simplify(points: List<Coordinate>): List<Coordinate> {
    if (points.size < 3) return points
    val longitudeScale = cos(points.first().latitudeE7 * Math.PI / 180.0 / 10_000_000.0)
    val keep = BooleanArray(points.size)
    keep[0] = true; keep[points.lastIndex] = true
    val pending = ArrayDeque<Pair<Int, Int>>()
    pending.addLast(0 to points.lastIndex)
    while (pending.isNotEmpty()) {
      val (first, last) = pending.removeLast()
      val a = points[first]; val b = points[last]
      val dx = (b.longitudeE7 - a.longitudeE7) * longitudeScale * METRES_PER_E7
      val dy = (b.latitudeE7 - a.latitudeE7) * METRES_PER_E7
      val lengthSquared = dx * dx + dy * dy
      var furthest = -1
      var maximum = TOLERANCE_M * TOLERANCE_M
      for (index in first + 1 until last) {
        val point = points[index]
        val x = (point.longitudeE7 - a.longitudeE7) * longitudeScale * METRES_PER_E7
        val y = (point.latitudeE7 - a.latitudeE7) * METRES_PER_E7
        val t = if (lengthSquared == 0.0) 0.0 else ((x * dx + y * dy) / lengthSquared).coerceIn(0.0, 1.0)
        val distance = (x - t * dx) * (x - t * dx) + (y - t * dy) * (y - t * dy)
        if (distance > maximum) { maximum = distance; furthest = index }
      }
      if (furthest >= 0) {
        keep[furthest] = true
        pending.addLast(first to furthest); pending.addLast(furthest to last)
      }
    }
    return points.filterIndexed { index, _ -> keep[index] }
  }

  private fun encode(points: List<Coordinate>): String = buildString {
    var latitude = 0L; var longitude = 0L
    fun appendDelta(delta: Long) {
      var value = (delta shl 1) xor (delta shr 63)
      while (value >= 32) { append(((value and 31) or 32).toInt().plus(63).toChar()); value = value shr 5 }
      append((value.toInt() + 63).toChar())
    }
    for (point in points) {
      appendDelta(point.latitudeE7 - latitude); appendDelta(point.longitudeE7 - longitude)
      latitude = point.latitudeE7; longitude = point.longitudeE7
    }
  }

  private fun decodePolyline(value: String): List<Coordinate> {
    var offset = 0
    fun delta(): Long {
      var result = 0L; var shift = 0
      while (true) {
        require(offset < value.length && shift <= 35) { "Invalid bucket route polyline" }
        val byte = value[offset++].code - 63
        require(byte in 0..63) { "Invalid bucket route polyline" }
        result = result or ((byte and 31).toLong() shl shift)
        if (byte < 32) return (result shr 1) xor -(result and 1)
        shift += 5
      }
    }
    val points = mutableListOf<Coordinate>()
    var latitude = 0L; var longitude = 0L
    while (offset < value.length) {
      latitude += delta(); longitude += delta()
      require(latitude in -900_000_000L..900_000_000L && longitude in -1_800_000_000L..1_800_000_000L)
      points.add(Coordinate(latitude, longitude))
    }
    require(points.isNotEmpty()) { "Empty bucket route segment" }
    return points
  }
}
