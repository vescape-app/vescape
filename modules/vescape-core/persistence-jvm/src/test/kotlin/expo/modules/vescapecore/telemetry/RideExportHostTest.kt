package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.nio.file.Files
import java.io.File
import java.net.URI
import javax.xml.parsers.DocumentBuilderFactory
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RideExportHostTest {
  @Test fun completeRawPagesScopePrecisionAndGpx(): Unit = runBlocking {
    val fixture = JSONObject(File("../shared/ride-export-contract.json").readText())
    val count = fixture.getInt("count")
    val prefix = fixture.getInt("imprecisePrefix")
    val base = fixture.getLong("baseMs")
    val dir = Files.createTempDirectory("ride-export").toFile()
    val db = Room.databaseBuilder<TelemetryRoomDatabase>(File(dir, "test.db").path)
      .setDriver(BundledSQLiteDriver()).build()
    try {
      val dao = db.telemetryDao()
      fun point(i: Int) = RideTrackPointEntity(recordingId = "ride", boardId = "board", fixAtMs = base + i / 3,
        latitudeE7 = 521234567 + i, longitudeE7 = -211234567, accuracyCm = if (i < prefix) 2001 else 2000,
        gpsSpeedCentiMps = if (i % 2 == 0) 456 else null, bearingCentiDeg = null, altitudeCm = if (i % 2 == 0) -1234 else null)
      dao.insertRideTrackPoints((0 until count).map(::point))
      val other = point(1200)
      dao.insertRideTrackPoints(listOf(other.copy(boardId = "other"), other.copy(recordingId = "other"),
        other.copy(recordingId = null, accuracyCm = null), other.copy(accuracyCm = null), other.copy(boardId = null)))
      val from = base + 1
      val to = base + (count - 4) / 3
      suspend fun export(board: String? = "board", recording: String? = "ride", start: Long = from, end: Long = to): String {
        val result = RideExport.gpx(dao, dir, mapOf("fromMs" to start, "toMs" to end,
          "boardId" to board, "recordingId" to recording, "name" to fixture.getString("name")))
        val file = File(URI(result["uri"] as String))
        assertEquals(dir.canonicalPath, file.parentFile.canonicalPath)
        assertEquals("application/gpx+xml", result["mimeType"])
        val text = file.readText()
        val factory = DocumentBuilderFactory.newInstance(); factory.isNamespaceAware = true
        factory.newDocumentBuilder().parse(file)
        return text
      }
      val xml = export()
      val expected = (0 until count).filter { it >= prefix && base + it / 3 in from..to }
      assertEquals(expected.size, "<trkpt ".toRegex().findAll(xml).count())
      var previous = -1
      for (i in expected) {
        val offset = xml.indexOf("lat=\"${(521234567 + i) / 10_000_000.0}\"")
        assertTrue("point $i lost or reordered", offset > previous); previous = offset
      }
      assertTrue(xml.contains("<name>${fixture.getString("escapedName")}</name>"))
      assertTrue(xml.contains("<ele>-12.34</ele>"))
      assertTrue(xml.contains("<gpxtpx:speed>4.56</gpxtpx:speed>"))
      val one = export(start = base, end = base)
      assertFalse(one.contains("<trkpt "))
      // Exact timestamp includes all three equal-time points, with optional fields only when stored.
      val small = export(start = base + 400, end = base + 400)
      assertEquals(3, "<trkpt ".toRegex().findAll(small).count())
      assertEquals(2, "<ele>".toRegex().findAll(small).count())
      assertTrue(small.contains("<time>2023-11-14T22:13:20.523Z</time>"))
      assertEquals(expected.size + 2, "<trkpt ".toRegex().findAll(export(recording = null)).count())
      assertEquals(1, "<trkpt ".toRegex().findAll(export(board = null)).count())
      assertFalse(export(board = "empty").contains("<trkpt "))
    } finally { db.close(); dir.deleteRecursively() }
  }
}
