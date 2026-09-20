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

  suspend fun gpx(dao: TelemetryDao, directory: File, options: Map<String, Any?>): Map<String, Any> =
    file(dao, directory, options, false)

  suspend fun csv(dao: TelemetryDao, directory: File, options: Map<String, Any?>): Map<String, Any> =
    file(dao, directory, options, true)

  private suspend fun file(dao: TelemetryDao, directory: File, options: Map<String, Any?>, csv: Boolean): Map<String, Any> {
    val fromMs = (options["fromMs"] as? Number)?.toLong() ?: error("Missing export start")
    val toMs = (options["toMs"] as? Number)?.toLong() ?: error("Missing export end")
    require(fromMs <= toMs) { "Invalid export range" }
    val extension = if (csv) "csv" else "gpx"
    val file = File(directory, "vescape-ride-${UUID.randomUUID()}.$extension")
    try {
      file.bufferedWriter(Charsets.UTF_8).use { writer ->
        if (csv) writeCsv(dao, writer, fromMs, toMs, options["boardId"] as? String, options["recordingId"] as? String)
        else writeGpx(dao, writer, fromMs, toMs, options["boardId"] as? String,
          options["recordingId"] as? String, options["name"] as? String ?: "Vescape ride")
      }
      return mapOf("uri" to file.toURI().toString(), "mimeType" to if (csv) "text/csv" else "application/gpx+xml", "uti" to if (csv) "public.comma-separated-values-text" else "com.topografix.gpx")
    } catch (error: Throwable) { file.delete(); throw error }
  }

  // Caller holds a database snapshot for the complete export.
  suspend fun writeGpx(dao: TelemetryDao, writer: Writer, fromMs: Long, toMs: Long,
    boardId: String?, recordingId: String?, name: String) {
    writer.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
    writer.write("<gpx version=\"1.1\" creator=\"Vescape\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v2\"><trk><name>${xml(name)}</name><trkseg>\n")
    var afterMs = fromMs
    var afterId = Long.MIN_VALUE
    while (true) {
      val rows = dao.getRideExportTrackPage(fromMs, toMs, boardId, recordingId, afterMs, afterId, BATCH_SIZE)
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

  suspend fun writeCsv(dao: TelemetryDao, writer: Writer, fromMs: Long, toMs: Long,
    boardId: String?, recordingId: String?) {
    writer.write(csvLine(csvHeaders))
    val gps = TrackCursor(dao, fromMs, toMs, boardId, recordingId)
    var currentGps = gps.next()
    var nextGps = gps.next()
    val keyframe = dao.getRideExportKeyframe(fromMs, boardId, recordingId)
    val start = keyframe?.capturedAtMs ?: fromMs
    var afterMs = start
    // Include every row at the start timestamp, including keyframes sharing that timestamp.
    var afterId = Long.MIN_VALUE
    val values = arrayOfNulls<Number>(17)
    var previousRecording: String? = null
    while (true) {
      val rows = dao.getRideExportTelemetryPage(start, toMs, boardId, recordingId, afterMs, afterId, BATCH_SIZE)
      if (rows.isEmpty()) break
      for (f in rows) {
        if (f.flags and TELEMETRY_FLAG_KEYFRAME != 0 || f.recordingId != previousRecording) values.fill(null)
        previousRecording = f.recordingId
        // Storage mask bit order. A set bit with NULL explicitly clears an optional reading.
        val delta = arrayOf<Number?>(f.speedCentiKmh, f.batteryVoltageMv, f.motorCurrentMa, f.batteryCurrentMa,
          f.dutyPermille, f.pitchCentiDeg, f.rollCentiDeg, f.balancePitchCentiDeg, f.balanceCurrentMa,
          f.erpm, f.state, f.switchState, f.adc1Milli, f.adc2Milli, f.odometerCm, f.tempMosfetDeciC, f.tempMotorDeciC)
        for (i in values.indices) if (f.flags and TELEMETRY_FLAG_KEYFRAME != 0 || f.changedMask1 and (1 shl i) != 0) values[i] = delta[i]
        if (f.capturedAtMs < fromMs) continue
        while (nextGps != null && nextGps.fixAtMs <= f.capturedAtMs) {
          currentGps = nextGps; nextGps = gps.next()
        }
        fun scaled(i: Int, divisor: Double) = values[i]?.toDouble()?.div(divisor)
        val packedState = values[10]?.toInt()
        val switch = values[11]?.toInt()?.and(15)?.let { state ->
          when (state) { 0 -> 0; 2 -> 3; 1 -> if (values[12] == null || values[13] == null) null
            else if (values[12]!!.toInt() > values[13]!!.toInt()) 1 else 2; else -> null }
        }
        val p = currentGps
        writer.write(csvLine(listOf(f.capturedAtMs, scaled(0, 100.0), scaled(4, 1000.0), scaled(1, 1000.0),
          scaled(3, 1000.0), scaled(2, 1000.0), scaled(16, 10.0), scaled(15, 10.0), scaled(14, 100.0),
          scaled(6, 100.0), scaled(7, 100.0), scaled(5, 100.0), packedState?.and(15), switch,
          packedState?.ushr(4)?.and(15), scaled(12, 1000.0), scaled(13, 1000.0), p?.altitudeCm?.div(100.0),
          p?.latitudeE7?.div(10_000_000.0), p?.longitudeE7?.div(10_000_000.0), p?.accuracyCm?.div(100.0),
          p?.gpsSpeedCentiMps?.div(100.0), p?.fixAtMs, values[9], scaled(8, 1000.0), values[11])))
      }
      afterMs = rows.last().capturedAtMs; afterId = rows.last().id
    }
  }

  private class TrackCursor(val dao: TelemetryDao, val fromMs: Long, val toMs: Long,
    val boardId: String?, val recordingId: String?) {
    var rows = emptyList<RideTrackPointEntity>()
    var index = 0
    var afterMs = fromMs
    var afterId = Long.MIN_VALUE
    var finished = false
    suspend fun next(): RideTrackPointEntity? {
      while (!finished) {
        if (index == rows.size) {
          rows = dao.getRideExportTrackPage(fromMs, toMs, boardId, recordingId, afterMs, afterId, BATCH_SIZE)
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
