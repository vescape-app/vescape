package expo.modules.vescapecore.telemetry

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
  const val BATCH_SIZE = 1000
  private val time = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).withZone(ZoneOffset.UTC)

  suspend fun gpx(dao: TelemetryDao, directory: File, options: Map<String, Any?>): Map<String, Any> {
    val fromMs = (options["fromMs"] as? Number)?.toLong() ?: error("Missing export start")
    val toMs = (options["toMs"] as? Number)?.toLong() ?: error("Missing export end")
    require(fromMs <= toMs) { "Invalid export range" }
    val file = File(directory, "vescape-ride-${UUID.randomUUID()}.gpx")
    try {
      file.bufferedWriter(Charsets.UTF_8).use { writer ->
        writeGpx(dao, writer, fromMs, toMs, options["boardId"] as? String,
          options["recordingId"] as? String, options["name"] as? String ?: "Vescape ride")
      }
      return mapOf("uri" to file.toURI().toString(), "mimeType" to "application/gpx+xml", "uti" to "com.topografix.gpx")
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
        writer.write("<trkpt lat=\"${p.latitudeE7 / 10_000_000.0}\" lon=\"${p.longitudeE7 / 10_000_000.0}\">")
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
