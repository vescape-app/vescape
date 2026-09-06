package expo.modules.vescapecore.recording

import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteFullException
import expo.modules.vescapecore.telemetry.RecordingWriteGate
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
    reporter.report(RecordingStorageFailureKind.FullDisk, SQLiteFullException("private SQL and args"))
    reporter.report(RecordingStorageFailureKind.FullDisk, SQLiteFullException("again"))
    assertEquals(1, reports.size)
    assertEquals(
      RecordingFailureReport("recording_commit", "full_disk", "SQLiteFullException"),
      reports.single(),
    )
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
}
