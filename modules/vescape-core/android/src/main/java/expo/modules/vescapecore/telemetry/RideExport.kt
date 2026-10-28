package expo.modules.vescapecore.telemetry

import androidx.room.useReaderConnection
import androidx.room.deferredTransaction
import java.io.File
import java.io.Writer
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import kotlin.math.floor

/** Export intent and temporary-file result cross the bridge; null Board means unassigned Board.
 * @parity /modules/vescape-core/ios/telemetry/RideExport.swift
 * @parity /modules/vescape-core/src/index.ts `RideExportOptions`
 * @parity /modules/vescape-core/src/index.ts `RideExportFile`
 */
internal object RideExport {
  // Driver-backed export Room instance: one WAL read snapshot across all generated DAO calls.
  suspend fun <T> snapshot(db: TelemetryRoomDatabase, block: suspend (TelemetryDao) -> T): T =
    db.useReaderConnection { reader -> reader.deferredTransaction { block(db.telemetryDao()) } }

  const val BATCH_SIZE = 1000
  private val time = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).withZone(ZoneOffset.UTC)

  enum class Format(val extension: String, val mimeType: String, val uti: String) {
    GPX("gpx", "application/gpx+xml", "com.topografix.gpx"),
    CSV("csv", "text/csv", "public.comma-separated-values-text"),
    FLOATY("json", "application/json", "public.json"),
  }

  suspend fun gpx(dao: TelemetryDao, directory: File, options: Map<String, Any?>): Map<String, Any> =
    file(directory, options, Format.GPX) { writer, fromMs, toMs, boardId ->
      writeGpx(dao, writer, fromMs, toMs, boardId, options["name"] as? String ?: "Vescape ride")
    }

  suspend fun csv(dao: TelemetryDao, directory: File, options: Map<String, Any?>): Map<String, Any> =
    file(directory, options, Format.CSV) { writer, fromMs, toMs, boardId -> writeCsv(dao, writer, fromMs, toMs, boardId) }

  /** [batteryPercent] is the Board's 0–100 estimate for pack volts and battery amps, null when unknown. */
  suspend fun floaty(dao: TelemetryDao, directory: File, options: Map<String, Any?>,
    batteryPercent: (voltageV: Double, batteryCurrentA: Double) -> Double?): Map<String, Any> =
    file(directory, options, Format.FLOATY) { writer, fromMs, toMs, boardId ->
      writeFloaty(dao, writer, fromMs, toMs, boardId, options["name"] as? String, batteryPercent)
    }

  private suspend inline fun file(directory: File, options: Map<String, Any?>, format: Format,
    body: (Writer, Long, Long, String?) -> Unit): Map<String, Any> {
    val fromMs = (options["fromMs"] as? Number)?.toLong() ?: error("Missing export start")
    val toMs = (options["toMs"] as? Number)?.toLong() ?: error("Missing export end")
    require(fromMs <= toMs) { "Invalid export range" }
    return write(directory, "vescape-ride", format) { writer -> body(writer, fromMs, toMs, options["boardId"] as? String) }
  }

  /** Live telemetry, every frame at full rate, in the ride CSV's columns. Live frames carry no GPS fix,
   * so the location columns stay empty.
   * @parity /modules/vescape-core/ios/telemetry/RideExport.swift `liveCsv`
   */
  fun liveCsv(rows: List<Map<String, Any?>>, directory: File): Map<String, Any> {
    require(rows.isNotEmpty()) { "No live telemetry to export" }
    return write(directory, "vescape-live", Format.CSV) { writer -> writeLiveCsv(writer, rows) }
  }

  private inline fun write(directory: File, prefix: String, format: Format, body: (Writer) -> Unit): Map<String, Any> {
    val file = File(directory, "$prefix-${UUID.randomUUID()}.${format.extension}")
    try {
      file.bufferedWriter(Charsets.UTF_8).use(body)
      return mapOf("uri" to file.toURI().toString(), "mimeType" to format.mimeType, "uti" to format.uti)
    } catch (error: Throwable) { file.delete(); throw error }
  }

  // Caller holds a database snapshot for the complete export.
  suspend fun writeGpx(dao: TelemetryDao, writer: Writer, fromMs: Long, toMs: Long,
    boardId: String?, name: String) {
    writer.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
    writer.write("<gpx version=\"1.1\" creator=\"Vescape\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v2\"><trk><name>${xml(name)}</name><trkseg>\n")
    var afterMs = fromMs
    var afterId = Long.MIN_VALUE
    while (true) {
      val rows = dao.getRideExportTrackPage(fromMs, toMs, boardId, afterMs, afterId, BATCH_SIZE)
      if (rows.isEmpty()) break
      for (p in rows) {
        if (!p.isPrecise()) continue
        writer.write("<trkpt lat=\"${coordinate(p.latitudeE7)}\" lon=\"${coordinate(p.longitudeE7)}\">")
        p.altitudeCm?.let { writer.write("<ele>${it / 100.0}</ele>") }
        writer.write("<time>${time.format(Instant.ofEpochMilli(p.fixAtMs))}</time>")
        p.gpsSpeedCentiMps?.let { writer.write("<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${it / 100.0}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>") }
        writer.write("</trkpt>\n")
      }
      afterMs = rows.last().fixAtMs
      afterId = rows.last().id
    }
    writer.write("</trkseg></trk></gpx>\n")
  }

  val csvHeaders = listOf("timestamp", "speed", "dutyCycle", "batteryVolts", "batteryCurrent", "motorCurrent",
    "motorTemp", "controllerTemp", "lifeDistance", "rollAngle", "pitchAngle", "truePitchAngle", "state",
    "switchState", "setpointAdjustmentType", "adc1", "adc2", "altitude", "latitude", "longitude", "accuracy",
    "gpsSpeed", "gpsTimestamp", "erpm", "balanceCurrent", "rawSwitchState")

  internal fun csvLine(cells: List<Any?>): String = cells.joinToString(",") { value ->
    val text = value?.toString() ?: ""
    if (text.any { it == ',' || it == '"' || it == '\r' || it == '\n' }) "\"${text.replace("\"", "\"\"")}\"" else text
  } + "\r\n"

  suspend fun writeCsv(dao: TelemetryDao, writer: Writer, fromMs: Long, toMs: Long, boardId: String?) {
    writer.write(csvLine(csvHeaders))
    val gps = TrackCursor(dao, fromMs, toMs, boardId)
    var currentGps = gps.next()
    var nextGps = gps.next()
    forEachFrame(dao, fromMs, toMs, boardId) { timestamp, values ->
      while (nextGps != null && nextGps!!.fixAtMs <= timestamp) {
        currentGps = nextGps; nextGps = gps.next()
      }
      fun scaled(i: Int, divisor: Double) = values[i]?.toDouble()?.div(divisor)
      val packedState = values[10]?.toInt()
      val p = currentGps
      writer.write(csvLine(listOf(timestamp, scaled(0, 100.0), scaled(4, 1000.0), scaled(1, 1000.0),
        scaled(3, 1000.0), scaled(2, 1000.0), scaled(16, 10.0), scaled(15, 10.0), scaled(14, 100.0),
        scaled(6, 100.0), scaled(7, 100.0), scaled(5, 100.0), packedState?.and(15),
        footpadSwitch(values[11]?.toInt(), scaled(12, 1000.0), scaled(13, 1000.0)),
        packedState?.ushr(4)?.and(15), scaled(12, 1000.0), scaled(13, 1000.0), p?.altitudeCm?.div(100.0),
        p?.latitudeE7?.div(10_000_000.0), p?.longitudeE7?.div(10_000_000.0), p?.accuracyCm?.div(100.0),
        p?.gpsSpeedCentiMps?.div(100.0), p?.fixAtMs, values[9], scaled(8, 1000.0), values[11])))
    }
  }

  /** Integration stops across gaps longer than this, so a paused recording adds no energy. */
  const val FLOATY_GAP_MS = 5000L

  /** Floaty 3 session JSON (`schemaVersion` 2) in Floaty's units: every stored frame as a log, every
   * precise fix as a location, timestamps unique per array, no nulls in either. Session totals come
   * after the arrays, so one streaming pass suffices.
   * @parity /modules/vescape-core/ios/telemetry/RideExport.swift `writeFloaty`
   */
  suspend fun writeFloaty(dao: TelemetryDao, writer: Writer, fromMs: Long, toMs: Long, boardId: String?,
    name: String?, batteryPercent: (voltageV: Double, batteryCurrentA: Double) -> Double?) {
    val id = floatyId(fromMs, toMs, boardId)
    val sessionId = ",\"sessionId\":\"$id\"}"
    writer.write("{\"schemaVersion\":2,\"id\":\"$id\",\"name\":${name?.let(::jsonString) ?: "null"},\"boardId\":${jsonString(boardId ?: "")},\"startTime\":$fromMs,\"endTime\":$toMs,\"stopReason\":null,\"userId\":null,\"groupRideId\":null,\"logs\":[")
    var lastLog: Long? = null
    var startOdometer: Long? = null
    var tripCm = 0L
    var previousVoltage: Long? = null
    var previousCurrent: Long? = null
    // mA·ms and µW·ms stay integral, so both platforms round the same totals.
    var milliAmpMs = 0L
    var microWattMs = 0L
    forEachFrame(dao, fromMs, toMs, boardId) { timestamp, v ->
      if (timestamp == lastLog) return@forEachFrame
      val last = lastLog
      val mv = previousVoltage
      val ma = previousCurrent
      if (last != null && mv != null && ma != null && timestamp - last <= FLOATY_GAP_MS) {
        milliAmpMs += ma * (timestamp - last); microWattMs += mv * ma * (timestamp - last)
      }
      lastLog = timestamp; previousVoltage = v[1]; previousCurrent = v[3]
      v[14]?.let { odometer ->
        if (startOdometer == null) startOdometer = odometer
        tripCm = odometer - (startOdometer ?: odometer)
      }
      val percent = v[1]?.let { batteryPercent(it / 1000.0, (v[3] ?: 0L) / 1000.0) }
        ?.let { floor(it.coerceIn(0.0, 100.0) * 100 + 0.5).toLong() } ?: 0L
      fun d(i: Int, scale: Int) = decimal(v[i] ?: 0L, scale)
      val packedState = v[10] ?: 0L
      val footpad = footpadSwitch(v[11]?.toInt(), v[12]?.div(1000.0), v[13]?.div(1000.0)) ?: 0
      writer.write((if (last == null) "" else ",") + "{\"timestamp\":$timestamp,\"speed\":${d(0, 2)},\"dutyCycle\":${d(4, 3)},\"batteryVolts\":${d(1, 3)},\"batteryPercent\":${decimal(percent, 4)},\"batteryCurrent\":${d(3, 3)},\"motorCurrent\":${d(2, 3)},\"motorTemp\":${d(16, 1)},\"controllerTemp\":${d(15, 1)},\"tripDistance\":${decimal(tripCm, 5)},\"lifeDistance\":${d(14, 5)},\"remainingDistance\":0,\"rollAngle\":${d(6, 2)},\"pitchAngle\":${d(7, 2)},\"truePitchAngle\":${d(5, 2)},\"inputTilt\":0,\"throttle\":0,\"ampHours\":${decimal(roundDiv(milliAmpMs, 3_600), 6)},\"wattHours\":${decimal(roundDiv(microWattMs, 3_600_000), 6)},\"state\":${packedState and 15},\"switchState\":$footpad,\"setpointAdjustmentType\":${(packedState shr 4) and 15},\"faultCode\":0,\"adc1\":${d(12, 3)},\"adc2\":${d(13, 3)},\"batteryUtilization\":0,\"phaseUtilization\":0" + sessionId)
    }
    writer.write("],\"locations\":[")
    val gps = TrackCursor(dao, fromMs, toMs, boardId)
    var lastFix: Long? = null
    val polyline = StringBuilder()
    var lastLat = 0L
    var lastLon = 0L
    var minLat = Long.MAX_VALUE; var maxLat = Long.MIN_VALUE; var minLon = Long.MAX_VALUE; var maxLon = Long.MIN_VALUE
    while (true) {
      val p = gps.next() ?: break
      if (p.fixAtMs == lastFix) continue
      writer.write((if (lastFix == null) "" else ",") + "{\"timestamp\":${p.fixAtMs},\"speed\":${decimal((p.gpsSpeedCentiMps ?: 0) * 36L, 3)},\"altitude\":${decimal((p.altitudeCm ?: 0).toLong(), 2)},\"latitude\":${decimal(p.latitudeE7.toLong(), 7)},\"longitude\":${decimal(p.longitudeE7.toLong(), 7)},\"accuracy\":${decimal((p.accuracyCm ?: 0).toLong(), 2)}" + sessionId)
      lastFix = p.fixAtMs
      val lat = roundDiv(p.latitudeE7.toLong(), 100)
      val lon = roundDiv(p.longitudeE7.toLong(), 100)
      appendPolyline(lat - lastLat, polyline); appendPolyline(lon - lastLon, polyline)
      lastLat = lat; lastLon = lon
      minLat = minOf(minLat, p.latitudeE7.toLong()); maxLat = maxOf(maxLat, p.latitudeE7.toLong())
      minLon = minOf(minLon, p.longitudeE7.toLong()); maxLon = maxOf(maxLon, p.longitudeE7.toLong())
    }
    fun bound(e7: Long) = if (lastFix == null) "null" else decimal(e7, 7)
    writer.write("],\"distance\":${decimal(tripCm, 5)},\"polyline\":${if (lastFix == null) "null" else jsonString(polyline.toString())},\"minLatitude\":${bound(minLat)},\"maxLatitude\":${bound(maxLat)},\"minLongitude\":${bound(minLon)},\"maxLongitude\":${bound(maxLon)}}\n")
  }

  /** Name-based UUID v3 of the exported range, so re-importing the same ride replaces nothing. */
  fun floatyId(fromMs: Long, toMs: Long, boardId: String?): String =
    UUID.nameUUIDFromBytes("vescape-ride:${boardId ?: ""}:$fromMs:$toMs".toByteArray(Charsets.UTF_8)).toString()

  /** Google encoded polyline, one signed 1e-5 degree delta. */
  private fun appendPolyline(delta: Long, out: StringBuilder) {
    var v = if (delta < 0) (delta shl 1).inv() else delta shl 1
    while (v >= 0x20) { out.append(((0x20L or (v and 0x1f)) + 63).toInt().toChar()); v = v ushr 5 }
    out.append((v + 63).toInt().toChar())
  }

  /** Exact decimal for an integer stored at [scale] fractional digits, trailing zeros trimmed. */
  private fun decimal(value: Long, scale: Int): String {
    var divisor = 1L
    repeat(scale) { divisor *= 10 }
    val magnitude = kotlin.math.abs(value)
    val fraction = (magnitude % divisor).toString().padStart(scale, '0').trimEnd('0')
    return "${if (value < 0) "-" else ""}${magnitude / divisor}${if (fraction.isEmpty()) "" else ".$fraction"}"
  }

  /** Half-up integer division for positive [divisor]. */
  private fun roundDiv(value: Long, divisor: Long): Long = Math.floorDiv(value + divisor / 2, divisor)

  private fun jsonString(value: String): String = buildString {
    append('"')
    value.codePoints().forEach { c ->
      when {
        c == 34 -> append("\\\"")
        c == 92 -> append("\\\\")
        c < 0x20 -> append("\\u%04x".format(Locale.ROOT, c))
        else -> appendCodePoint(c)
      }
    }
    append('"')
  }

  /** Every stored frame in range with its reconstructed values, replaying the mask chain from the
   * preceding keyframe. Values are in storage mask bit order; a set bit with NULL clears a reading.
   */
  private suspend inline fun forEachFrame(dao: TelemetryDao, fromMs: Long, toMs: Long, boardId: String?,
    body: (timestamp: Long, values: Array<Long?>) -> Unit) {
    val keyframe = dao.getRideExportKeyframe(fromMs, boardId)
    val start = keyframe?.capturedAtMs ?: fromMs
    var afterMs = start
    // Include every row at the start timestamp, including keyframes sharing that timestamp.
    var afterId = Long.MIN_VALUE
    val values = arrayOfNulls<Long>(17)
    while (true) {
      val rows = dao.getRideExportTelemetryPage(start, toMs, boardId, afterMs, afterId, BATCH_SIZE)
      if (rows.isEmpty()) break
      for (f in rows) {
        if (f.flags and TELEMETRY_FLAG_KEYFRAME != 0) values.fill(null)
        val delta = arrayOf(f.speedCentiKmh, f.batteryVoltageMv, f.motorCurrentMa, f.batteryCurrentMa,
          f.dutyPermille, f.pitchCentiDeg, f.rollCentiDeg, f.balancePitchCentiDeg, f.balanceCurrentMa,
          f.erpm, f.state, f.switchState, f.adc1Milli, f.adc2Milli, f.odometerCm, f.tempMosfetDeciC, f.tempMotorDeciC)
        for (i in values.indices) if (f.flags and TELEMETRY_FLAG_KEYFRAME != 0 || f.changedMask1 and (1 shl i) != 0) values[i] = delta[i]?.toLong()
        if (f.capturedAtMs >= fromMs) body(f.capturedAtMs, values)
      }
      afterMs = rows.last().capturedAtMs; afterId = rows.last().id
    }
  }

  private fun writeLiveCsv(writer: Writer, rows: List<Map<String, Any?>>) {
    writer.write(csvLine(csvHeaders))
    for (row in rows) {
      fun num(key: String) = (row[key] as? Number)?.toDouble()
      val packedState = (row["state"] as? Number)?.toInt()
      val rawSwitch = (row["switchState"] as? Number)?.toInt()
      writer.write(csvLine(listOf(row["lastPacketAt"], num("speed"), num("dutyCycle"), num("batteryVoltage"),
        num("batteryCurrent"), num("motorCurrent"), num("tempMotor"), num("tempMosfet"), num("odometer"),
        num("roll"), num("balancePitch"), num("pitch"), packedState?.and(15),
        footpadSwitch(rawSwitch, num("adc1"), num("adc2")), packedState?.ushr(4)?.and(15), num("adc1"),
        num("adc2"), null, null, null, null, null, null, row["erpm"], num("balanceCurrent"), rawSwitch)))
    }
  }

  /** Float Control's switch column from Refloat's raw state: one pad down reads as the side that is. */
  private fun footpadSwitch(raw: Int?, adc1: Double?, adc2: Double?): Int? = when (raw?.and(15)) {
    0 -> 0
    2 -> 3
    1 -> if (adc1 == null || adc2 == null) null else if (adc1 > adc2) 1 else 2
    else -> null
  }

  private class TrackCursor(val dao: TelemetryDao, val fromMs: Long, val toMs: Long,
    val boardId: String?) {
    var rows = emptyList<RideTrackPointEntity>()
    var index = 0
    var afterMs = fromMs
    var afterId = Long.MIN_VALUE
    var finished = false
    suspend fun next(): RideTrackPointEntity? {
      while (!finished) {
        if (index == rows.size) {
          rows = dao.getRideExportTrackPage(fromMs, toMs, boardId, afterMs, afterId, BATCH_SIZE)
          index = 0
          if (rows.isEmpty()) { finished = true; return null }
          afterMs = rows.last().fixAtMs; afterId = rows.last().id
        }
        val point = rows[index++]
        if (point.isPrecise()) return point
      }
      return null
    }
  }

  private fun coordinate(e7: Int): String {
    val magnitude = kotlin.math.abs(e7.toLong())
    return "${if (e7 < 0) "-" else ""}${magnitude / 10_000_000}.${(magnitude % 10_000_000).toString().padStart(7, '0')}"
  }

  private fun xml(value: String): String = buildString {
    value.codePoints().forEach { c ->
      when (c) {
        38 -> append("&amp;"); 60 -> append("&lt;"); 62 -> append("&gt;")
        34 -> append("&quot;"); 39 -> append("&apos;")
        else -> if (c == 9 || c == 10 || c == 13 || c in 0x20..0xD7FF || c in 0xE000..0xFFFD || c in 0x10000..0x10FFFF) appendCodePoint(c)
      }
    }
  }
}
