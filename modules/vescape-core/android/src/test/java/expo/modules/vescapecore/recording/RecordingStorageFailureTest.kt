package expo.modules.vescapecore.recording

import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteFullException
import expo.modules.vescapecore.telemetry.RecordingWriteGate
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** @parity /modules/vescape-core/ios/recording/RecordingStorageFailureTests.swift */
class RecordingStorageFailureTest {
  @Test fun `shared failure fixture classifies platform errors`() {
    val fixture = JSONObject(checkNotNull(javaClass.classLoader?.getResource("recording-failure-contract.json")).readText())
    val scenarios = fixture.getJSONArray("scenarios")
    val errors = mapOf(
      1 to SQLiteException("deterministic"),
      13 to SQLiteFullException("full"),
      10 to SQLiteDiskIOException("io"),
    )
    for (index in 0 until scenarios.length()) {
      val scenario = scenarios.getJSONObject(index)
      val kind = RecordingStorageFailure.classify(checkNotNull(errors[scenario.getInt("sqliteCode")]))
      assertEquals(scenario.getString("expectedKind"), kind.wireValue)
      assertEquals(scenario.getBoolean("storageUnavailable"), kind != RecordingStorageFailureKind.WriteFailed)
      val bridgeState = recordingFailureState(kind)
      assertEquals(scenario.getString("expectedKind"), bridgeState["kind"])
      assertEquals(scenario.getBoolean("storageUnavailable"), bridgeState["storageUnavailable"])
    }
  }

  @Test fun `nested storage failure keeps broad classification`() {
    assertEquals(
      RecordingStorageFailureKind.FullDisk,
      RecordingStorageFailure.classify(IllegalStateException("commit", SQLiteFullException("full"))),
    )
  }

  @Test fun `report is sanitized and emitted once per episode`() {
    val reports = mutableListOf<RecordingFailureReport>()
    val reporter = RecordingFailureReporter(reports::add)
    reporter.report("recording_commit", "full_disk", SQLiteFullException("private SQL and args"))
    reporter.report("recording_commit", "full_disk", SQLiteFullException("again"))
    assertEquals(1, reports.size)
    assertEquals(
      RecordingFailureReport("recording_commit", "full_disk", "SQLiteFullException"),
      reports.single(),
    )
  }

  @Test fun `different read operations each report once without recording labels`() {
    val reports = mutableListOf<RecordingFailureReport>()
    val reporter = RecordingFailureReporter(reports::add)
    reporter.report("history_page_read", "query_failed", SQLiteException("private"))
    reporter.report("history_page_read", "query_failed", SQLiteException("again"))
    reporter.report("profile_stats_read", "query_failed", SQLiteException("private"))
    assertEquals(listOf("history_page_read", "profile_stats_read"), reports.map { it.operation })
    assertEquals(listOf("query_failed", "query_failed"), reports.map { it.category })
  }

  @Test fun `write gate stops ingestion and reports once`() {
    var reports = 0
    val gate = RecordingWriteGate(onFailure = { reports++ })
    assertEquals(true, gate.isAccepting())
    gate.fail(SQLiteException("deterministic"))
    gate.fail(SQLiteFullException("full"))
    assertEquals(false, gate.isAccepting())
    assertEquals(1, reports)
  }

  @Test fun `write gate can inherit an existing process failure`() {
    val gate = RecordingWriteGate(onFailure = {}, initiallyAccepting = false)
    assertEquals(false, gate.isAccepting())
  }

  @Test fun `generic failure cannot hide a broad outage`() {
    assertEquals(
      RecordingStorageFailureKind.FullDisk,
      resolveRecordingFailureKind(RecordingStorageFailureKind.FullDisk, RecordingStorageFailureKind.WriteFailed),
    )
  }

  @Test fun `reporter calls sink outside dedup monitor`() {
    val operations = mutableListOf<String>()
    lateinit var reporter: RecordingFailureReporter
    reporter = RecordingFailureReporter { report ->
      operations += report.operation
      if (report.operation == "first") reporter.report("second", "query_failed", SQLiteException("nested"))
    }
    reporter.report("first", "query_failed", SQLiteException("first"))
    assertEquals(listOf("first", "second"), operations)
  }

  @Test fun `successful suspended startup probe cannot erase runtime broad outage`() {
    val state = StorageFailureState()
    val probeGeneration = state.startupGeneration()
    state.record(RecordingStorageFailureKind.StorageUnavailable)
    assertEquals(false, state.clearAfterSuccessfulStartup(probeGeneration))
    assertEquals(RecordingStorageFailureKind.StorageUnavailable, state.current)
  }

  @Test fun `disconnected outage emits once and rejects next storage intent without a database read`() {
    val state = StorageFailureState()
    var events = 0
    var reads = 0
    val bridge = StorageOutageEventBridge(shouldEmit = { true }, emit = { events++ })
    if (state.record(RecordingStorageFailureKind.StorageUnavailable)) bridge.onOutage()
    if (state.record(RecordingStorageFailureKind.StorageUnavailable)) bridge.onOutage()

    assertThrows(StorageUnavailableException::class.java) {
      withAvailableStorage(state.current) { reads++ }
    }
    assertEquals(1, events)
    assertEquals(0, reads)
  }
}
