package expo.modules.vescapecore.navigation

/**
 * @parity /modules/vescape-core/ios/navigation/Polyline6.swift
 */
object Polyline6 {
  private const val SCALE = 1e6

  fun decode(encoded: String): List<Pair<Double, Double>> {
    val cursor = Cursor(encoded)
    val points = mutableListOf<Pair<Double, Double>>()
    var latitude = 0
    var longitude = 0

    while (cursor.hasMore) {
      val latitudeDelta = cursor.nextDelta() ?: break
      val longitudeDelta = cursor.nextDelta() ?: break
      latitude += latitudeDelta
      longitude += longitudeDelta
      points += (latitude / SCALE) to (longitude / SCALE)
    }

    return points
  }

  fun encode(points: List<Pair<Double, Double>>): String {
    val encoded = StringBuilder()
    var latitude = 0
    var longitude = 0

    for ((pointLatitude, pointLongitude) in points) {
      val nextLatitude = Math.round(pointLatitude * SCALE).toInt()
      val nextLongitude = Math.round(pointLongitude * SCALE).toInt()
      encoded.appendDelta(nextLatitude - latitude)
      encoded.appendDelta(nextLongitude - longitude)
      latitude = nextLatitude
      longitude = nextLongitude
    }

    return encoded.toString()
  }

  private fun StringBuilder.appendDelta(delta: Int) {
    var remaining = if (delta < 0) (delta shl 1).inv() else delta shl 1
    while (remaining >= 0x20) {
      append(((0x20 or (remaining and 0x1f)) + 63).toChar())
      remaining = remaining shr 5
    }
    append((remaining + 63).toChar())
  }

  private class Cursor(private val encoded: String) {
    private var index = 0

    val hasMore: Boolean get() = index < encoded.length

    fun nextDelta(): Int? {
      var shift = 0
      var result = 0
      var chunk: Int

      do {
        if (index >= encoded.length) return null
        chunk = encoded[index++].code - 63
        result = result or ((chunk and 0x1f) shl shift)
        shift += 5
      } while (chunk >= 0x20)

      return if (result and 1 != 0) (result shr 1).inv() else result shr 1
    }
  }
}
