package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.nio.file.Files
import java.io.StringWriter
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import java.io.File
import java.net.URI
import javax.xml.parsers.DocumentBuilderFactory
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RideExportHostTest {
  @Test fun exportSnapshotAllowsRecordingCommitAndKeepsLaterPagesStable(): Unit = runBlocking {
    val dir = Files.createTempDirectory("ride-export-snapshot").toFile()
    val path = File(dir, "test.db").path
    val db = Room.databaseBuilder<TelemetryRoomDatabase>(path).setDriver(BundledSQLiteDriver()).build()
    val reader = db
    try {
      val dao = db.telemetryDao()
      fun point(i: Int) = RideTrackPointEntity(recordingId = "ride", boardId = "board", fixAtMs = i.toLong(),
        latitudeE7 = i, longitudeE7 = -i, accuracyCm = 100,
        gpsSpeedCentiMps = null, bearingCentiDeg = null, altitudeCm = null)
      val count = RideExport.BATCH_SIZE * 2 + 1
      dao.insertRideTrackPoints((0 until count).map(::point))
      val snapshotReading = CountDownLatch(1)
      val committed = CountDownLatch(1)
      val recording = async(Dispatchers.IO) {
        check(snapshotReading.await(10, TimeUnit.SECONDS)) { "Export never started reading" }
        try { dao.insertRideTrackPoints(listOf(point(count))) } finally { committed.countDown() }
      }
      var paused = false
      val writer = object : StringWriter() {
        override fun write(text: String) {
          if (!paused && text.startsWith("<trkpt ")) {
            paused = true
            snapshotReading.countDown()
            check(committed.await(10, TimeUnit.SECONDS)) { "Export snapshot blocked recording commit" }
          }
          super.write(text)
        }
      }
      RideExport.snapshot(reader) { RideExport.writeGpx(it, writer, 0, count.toLong(), "board", "ride", "Snapshot") }
      recording.await()
      assertEquals(count, "<trkpt ".toRegex().findAll(writer.toString()).count())
      // A fresh snapshot sees the committed write that the held snapshot excluded from later pages.
      val fresh = StringWriter()
      RideExport.snapshot(reader) { RideExport.writeGpx(it, fresh, 0, count.toLong(), "board", "ride", "Fresh") }
      assertEquals(count + 1, "<trkpt ".toRegex().findAll(fresh.toString()).count())
    } finally { db.close(); dir.deleteRecursively() }
  }

  @Test fun completeCsvDeltaChainAndGpsMerge(): Unit = runBlocking {
    val root = JSONObject(File("../shared/ride-export-contract.json").readText())
    val fixture = root.getJSONObject("csv")
    val count = fixture.getInt("count")
    val base = root.getLong("baseMs")
    val initial = fixture.getJSONArray("initial")
    val dir = Files.createTempDirectory("ride-csv").toFile()
    val db = Room.databaseBuilder<TelemetryRoomDatabase>(File(dir, "test.db").path)
      .setDriver(BundledSQLiteDriver()).build()
    try {
      val dao = db.telemetryDao()
      fun frame(i: Int): TelemetryFrameEntity {
        val key = i % fixture.getInt("keyframeEvery") == 0
        val v = arrayOfNulls<Int>(17)
        if (key) for (j in v.indices) v[j] = initial.getInt(j)
        var mask = if (key) (1 shl 17) - 1 else 1
        v[0] = if (i == 1001) -90000 else i
        if (i == 3 || (key && i > 0)) { v[16] = null; mask = mask or (1 shl 16) }
        when (i) {
          1000 -> { v[11] = 194; mask = mask or (1 shl 11) }
          1001 -> { v[11] = 225; v[12] = 1000; v[13] = 2000; mask = mask or (7 shl 11) }
          1002 -> { v[11] = 208; mask = mask or (1 shl 11) }
          1003 -> { v[11] = 243; mask = mask or (1 shl 11) }
        }
        return TelemetryFrameEntity(capturedAtMs = base + i / 2, elapsedRealtimeMs = i.toLong(), boardId = "board",
          recordingId = "ride", canId = null, flags = if (key) 1 else 0, changedMask1 = mask, changedMask2 = 0,
          speedCentiKmh = v[0], batteryVoltageMv = v[1], motorCurrentMa = v[2], batteryCurrentMa = v[3],
          dutyPermille = v[4], pitchCentiDeg = v[5], rollCentiDeg = v[6], balancePitchCentiDeg = v[7],
          balanceCurrentMa = v[8], erpm = v[9], state = v[10], switchState = v[11], adc1Milli = v[12],
          adc2Milli = v[13], odometerCm = v[14]?.toLong(), tempMosfetDeciC = v[15], tempMotorDeciC = v[16])
      }
      for (start in 0 until count step 1000) dao.insertFrames((start until minOf(start + 1000, count)).map(::frame))
      dao.insertFrames(listOf(frame(0).copy(boardId = "other"), frame(0).copy(recordingId = "other"), frame(0).copy(boardId = null)))
      fun point(j: Int) = RideTrackPointEntity(recordingId = "ride", boardId = "board", fixAtMs = base + 100 + j / 2,
        latitudeE7 = 521234567 + j, longitudeE7 = -211234567, accuracyCm = 2000,
        gpsSpeedCentiMps = 456, bearingCentiDeg = null, altitudeCm = -1234)
      dao.insertRideTrackPoints((0..1100).map { point(0).copy(fixAtMs = base + 10, accuracyCm = 2001) })
      dao.insertRideTrackPoints((0..1005).map(::point))
      dao.insertRideTrackPoints(listOf(point(0).copy(recordingId = null, accuracyCm = null, fixAtMs = base + 5),
        point(0).copy(accuracyCm = null, fixAtMs = base + 2)))
      suspend fun export(board: String? = "board", recording: String? = "ride", from: Long = base + 1, to: Long = base + (count - 2) / 2): List<List<String>> {
        val result = RideExport.csv(dao, dir, mapOf("fromMs" to from, "toMs" to to, "boardId" to board, "recordingId" to recording))
        assertEquals("text/csv", result["mimeType"]); assertEquals("public.comma-separated-values-text", result["uti"])
        val lines = File(URI(result["uri"] as String)).readText().split("\r\n").dropLast(1)
        assertEquals(fixture.getString("headers"), lines.first())
        return lines.drop(1).map { it.split(',') }
      }
      val rows = export()
      assertEquals(count - 3, rows.size)
      for ((offset, row) in rows.withIndex()) {
        val i = offset + 2
        assertEquals(base + i / 2, row[0].toLong())
        assertEquals((if (i == 1001) -90000 else i) / 100.0, row[1].toDouble(), 0.0)
        assertEquals(26, row.size)
        val j = if (i / 2 < 100) 0 else minOf(1005, 2 * (i / 2 - 100) + 1)
        assertEquals((521234567 + j) / 10_000_000.0, row[18].toDouble(), 0.0)
        assertEquals(base + 100 + j / 2, row[22].toLong())
        assertEquals(if (i < 3) "43.2" else "", row[6])
      }
      val first = rows.first()
      assertEquals(listOf("0.789", "84.25", "3.456", "-12.345", "43.2", "32.1", "1234.56", "2.34", "-3.45", "-1.23", "7", "1", "10", "2.1", "1.1", "-12.34"), first.subList(2, 18))
      assertEquals(listOf("20.0", "4.56"), first.subList(20, 22))
      assertEquals(listOf("-6789", "4.567", "177"), first.subList(23, 26))
      assertEquals(listOf("3", "2", "0", ""), (1000..1003).map { rows[it - 2][13] })
      assertEquals("1", rows[5000 - 2][13])
      assertEquals(1, export(board = null, from = base, to = base).size)
      assertTrue(export(board = null, from = base, to = base).single().subList(17, 23).all { it.isEmpty() })
      assertTrue(export(board = "empty").isEmpty())
      assertEquals(base + 5, export(recording = null).first()[22].toLong())
      // Range begins mid-chain after more than one page; predecessor is replayed without emitting it.
      assertEquals("84.25", export(from = base + 1200, to = base + 1200).first()[3])
      // A keyframe later at the exact start timestamp must not erase the earlier delta rows' base.
      dao.insertFrames(listOf(frame(0).copy(capturedAtMs = base + 1200, batteryVoltageMv = 99000)))
      val boundary = export(from = base + 1200, to = base + 1200)
      assertEquals(listOf("84.25", "84.25", "99.0"), boundary.map { it[3] })
      dao.insertRideTrackPoints(listOf(point(0).copy(boardId = "gps-only")))
      assertTrue(export(board = "gps-only").isEmpty())
      val escape = fixture.getJSONArray("escapeInput")
      assertEquals(fixture.getString("escapeExpected"), RideExport.csvLine((0 until escape.length()).map { if (escape.isNull(it)) null else escape.getString(it) }))
    } finally { db.close(); dir.deleteRecursively() }
  }

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
        val offset = xml.indexOf("lat=\"${String.format(Locale.ROOT, "%.7f", (521234567 + i) / 10_000_000.0)}\"")
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
      val coordinates = fixture.getJSONArray("decimalCoordinates")
      dao.insertRideTrackPoints((0 until coordinates.length()).map { i ->
        val c = coordinates.getJSONObject(i)
        point(i).copy(boardId = "decimal", accuracyCm = 100, latitudeE7 = c.getInt("latitudeE7"), longitudeE7 = c.getInt("longitudeE7"))
      })
      val previousLocale = Locale.getDefault()
      try {
        Locale.setDefault(Locale.GERMANY)
        val decimal = export(board = "decimal", start = base, end = base + 10)
        for (i in 0 until coordinates.length()) {
          val c = coordinates.getJSONObject(i)
          assertTrue(decimal.contains("<trkpt lat=\"${c.getString("lat")}\" lon=\"${c.getString("lon")}\">"))
        }
      } finally { Locale.setDefault(previousLocale) }
    } finally { db.close(); dir.deleteRecursively() }
  }
}
