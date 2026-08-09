package expo.modules.vescapecore.navigation

/**
 * Decoder for Mapbox's `polyline6` geometry encoding — the Encoded Polyline Algorithm at 1e6
 * precision. Pure and dependency-free on purpose: the algorithm is a few lines and a decoder is not
 * worth a third-party package on either platform.
 *
 * The 1e6 scale is the whole trap. Classic Google polylines are 1e5, and decoding a polyline6 body
 * with a 1e5 scale yields coordinates ten times too large — which reads as a projection bug on the
 * map rather than as a decoding bug. Request `geometries=polyline6` and decode at 1e6, always.
 *
 * @parity /modules/vescape-core/ios/navigation/Polyline6.swift
 */
object Polyline6 {
  private const val SCALE = 1e6

  /**
   * Decoded points in encoding order, each `(latitude, longitude)`. Note that this is the opposite
   * order from the `[longitude, latitude]` pairs that cross the bridge as GeoJSON.
   *
   * A truncated or malformed body decodes to whatever prefix was well-formed rather than throwing:
   * a partial path is still drawable, and Navigation has no failure UI in this slice.
   */
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

  /** Walks the encoded string one zigzag varint at a time, so both axes share one reader. */
  private class Cursor(private val encoded: String) {
    private var index = 0

    val hasMore: Boolean get() = index < encoded.length

    /** Next delta, or `null` when the string ends part-way through one. */
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

      // Low bit is the sign, so negative values arrive as the inverted shifted magnitude.
      return if (result and 1 != 0) (result shr 1).inv() else result shr 1
    }
  }
}
