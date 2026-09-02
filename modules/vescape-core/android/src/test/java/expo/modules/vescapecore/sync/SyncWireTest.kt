package expo.modules.vescapecore.sync

import expo.modules.vescapecore.telemetry.AppSettingEntity
import expo.modules.vescapecore.telemetry.BoardEntity
import expo.modules.vescapecore.telemetry.SyncActionEntity
import expo.modules.vescapecore.telemetry.TelemetryFrameEntity
import expo.modules.vescapecore.telemetry.TelemetryMinuteBucketEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wire encoding and the bounds it refuses on. The valid/invalid boundary cases mirror the server's
 * own schema (`vescape-server` `src/sync/protocol.ts`), so a row this side accepts is a row that
 * side can store — a batch is whole or refused, and a bad row must never reach transport.
 *
 * @parity /modules/vescape-core/ios/sync/SyncWireTests.swift
 */
class SyncWireTest {
  private fun board(id: String = "board-1", name: String = "Board") = BoardEntity(
    id = id,
    name = name,
    bleId = null,
    createdAt = 10,
    updatedAt = 20,
  )

  private fun frame(boardId: String? = "board-1", speed: Int? = 100) = TelemetryFrameEntity(
    id = 5,
    capturedAtMs = 1_000,
    elapsedRealtimeMs = 500,
    boardId = boardId,
    canId = null,
    flags = 1,
    changedMask1 = 3,
    changedMask2 = 0,
    speedCentiKmh = speed,
    batteryVoltageMv = null,
    motorCurrentMa = null,
    batteryCurrentMa = null,
    dutyPermille = null,
    pitchCentiDeg = null,
    rollCentiDeg = null,
    balancePitchCentiDeg = null,
    balanceCurrentMa = null,
    erpm = null,
    state = null,
    switchState = null,
    adc1Milli = null,
    adc2Milli = null,
    odometerCm = null,
    tempMosfetDeciC = null,
    tempMotorDeciC = null,
    latitudeE7 = null,
    longitudeE7 = null,
    gpsSpeedCentiMps = null,
    bearingCentiDeg = null,
    accuracyCm = null,
    altitudeCm = null,
    locationTimestampMs = null,
  )

  @Test
  fun `a board encodes exactly the declared fields, nulls included`() {
    assertEquals(
      """{"id":"board-1","name":"Board","bleId":null,"transport":null,"createdAt":10,"updatedAt":20}""",
      SyncWire.board(board()),
    )
  }

  /** "Cleared" and "not mentioned" are different intents, and only one survives a missing key. */
  @Test
  fun `nullable columns are explicit nulls, never omitted keys`() {
    assertTrue(SyncWire.telemetryFrame(frame(speed = null)).contains("\"speedCentiKmh\":null"))
  }

  @Test
  fun `text is escaped so the body stays parseable`() {
    val encoded = SyncWire.board(board(name = "He said \"go\"\n"))
    assertTrue(encoded.contains("""\"go\""""))
    assertTrue(encoded.contains("""\n"""))
  }

  @Test
  fun `a key at the length limit is valid and one over is refused`() {
    val atLimit = "b".repeat(MAX_SYNC_KEY_LENGTH)
    SyncWire.board(board(id = atLimit))
    assertThrows(SyncProtocolException::class.java) {
      SyncWire.board(board(id = "b".repeat(MAX_SYNC_KEY_LENGTH + 1)))
    }
  }

  @Test
  fun `an empty key is refused where the server names it, and allowed where the phone derives it`() {
    assertThrows(SyncProtocolException::class.java) { SyncWire.board(board(id = "")) }
    SyncWire.appSetting(AppSettingEntity(key = "mapStyleKey", valueJson = "\"\"", updatedAt = 1))
  }

  /** A sample that names no Board has nowhere to go on the server, so it never reaches transport. */
  @Test
  fun `a frame without a board is a protocol error`() {
    val error = assertThrows(SyncProtocolException::class.java) {
      SyncWire.telemetryFrame(frame(boardId = null))
    }
    assertEquals("boardId", error.field)
  }

  @Test
  fun `integer bounds are enforced at the edge, not left to the server`() {
    SyncWire.telemetryFrame(frame(speed = Int.MAX_VALUE))
    val error = assertThrows(SyncProtocolException::class.java) {
      SyncWire.telemetryMinuteBucket(bucket(sampleCount = -1))
    }
    assertEquals("sampleCount", error.field)
  }

  @Test
  fun `a non-finite number is refused because JSON cannot express it`() {
    val error = assertThrows(SyncProtocolException::class.java) {
      SyncRowWriter(SyncTable.ALERTS).number("threshold", Double.NaN)
    }
    assertEquals("threshold", error.field)
  }

  /** An action reads like the row it names: flat identity fields, not a nested envelope. */
  @Test
  fun `a delete action expands into the identity its target declares`() {
    assertEquals(
      """{"target":"boardSetting","boardId":"board-1","key":"transport","deletedAt":9}""",
      SyncWire.deleteAction(
        SyncActionEntity(id = 1, target = "boardSetting", boardId = "board-1", key = "transport", deletedAt = 9),
      ),
    )
    assertEquals(
      """{"target":"tuneProfile","id":"profile-1","deletedAt":4}""",
      SyncWire.deleteAction(
        SyncActionEntity(id = 2, target = "tuneProfile", boardId = null, key = "profile-1", deletedAt = 4),
      ),
    )
    assertThrows(SyncProtocolException::class.java) {
      SyncWire.deleteAction(
        SyncActionEntity(id = 3, target = "somethingElse", boardId = null, key = "x", deletedAt = 1),
      )
    }
  }

  private fun bucket(sampleCount: Int) = TelemetryMinuteBucketEntity(
    bucketStartMs = 60_000,
    boardId = "board-1",
    sampleCount = sampleCount,
    firstSampleAtMs = 60_000,
    lastSampleAtMs = 60_500,
    sumAbsSpeedCentiKmh = 1,
    movingSpeedSampleCount = null,
    sumMovingAbsSpeedCentiKmh = null,
    maxAbsSpeedCentiKmh = 1,
    minBatteryVoltageMv = null,
    maxMotorCurrentAbsMa = 0,
    maxBatteryCurrentAbsMa = 0,
    batteryUsedWhMilli = 0,
    batteryRegenWhMilli = 0,
    maxDutyAbsPermille = 0,
    firstOdometerCm = null,
    lastOdometerCm = null,
    gpsPointCount = 0,
    preciseGpsPointCount = 0,
    gpsDistanceCm = 0,
    maxGpsSpeedCentiMps = null,
    updatedAt = 1,
  )
}
