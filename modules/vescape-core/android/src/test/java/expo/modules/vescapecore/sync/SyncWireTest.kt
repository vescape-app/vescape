package expo.modules.vescapecore.sync

import expo.modules.vescapecore.telemetry.AlertRuleEntity
import expo.modules.vescapecore.telemetry.AppSettingEntity
import expo.modules.vescapecore.telemetry.BoardEntity
import expo.modules.vescapecore.telemetry.BoardWarningEntity
import expo.modules.vescapecore.telemetry.SyncActionEntity
import expo.modules.vescapecore.telemetry.TelemetryFrameEntity
import expo.modules.vescapecore.telemetry.TelemetryMinuteBucketEntity
import expo.modules.vescapecore.telemetry.VescFaultCaptureEntity
import expo.modules.vescapecore.telemetry.VescFaultCaptureSampleEntity
import expo.modules.vescapecore.telemetry.VescFaultOccurrenceEntity
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

  /**
   * The whole reason the occurrence carries its own change timestamp: dismissal is a Rider edit the
   * restore has to preserve, and `lastObservedAtMs` cannot express it.
   */
  @Test
  fun `a fault occurrence carries its own change timestamp, not just the last observation`() {
    assertEquals(
      """{"id":"fault-1","boardId":"board-1","code":6,"occurredAtMs":1000,""" +
        """"lastObservedAtMs":2000,"clearedAtMs":null,"dismissed":true,"updatedAt":9000}""",
      SyncWire.vescFaultOccurrence(
        VescFaultOccurrenceEntity(
          id = "fault-1",
          boardId = "board-1",
          code = 6,
          occurredAtMs = 1_000,
          lastObservedAtMs = 2_000,
          clearedAtMs = null,
          dismissed = true,
          updatedAt = 9_000,
          syncSeq = 4,
        ),
      ),
    )
  }

  /** A Capture is immutable, so it carries no change timestamp — and no cursor either. */
  @Test
  fun `a fault capture encodes exactly the declared fields`() {
    assertEquals(
      """{"occurrenceId":"fault-1","boardId":"board-1","startedAtMs":500,"openedAtMs":1000,""" +
        """"sampleCount":42}""",
      SyncWire.vescFaultCapture(
        VescFaultCaptureEntity(
          occurrenceId = "fault-1",
          boardId = "board-1",
          startedAtMs = 500,
          openedAtMs = 1_000,
          sampleCount = 42,
          syncSeq = 7,
        ),
      ),
    )
  }

  /**
   * The local autoincrement id restarts on a fresh install, so it can never be identity: a restored
   * phone's re-upload has to be an idempotent no-op, keyed on the Occurrence and the capture time.
   */
  @Test
  fun `a capture sample sends no local row id and nulls what the firmware never reported`() {
    val encoded = SyncWire.vescFaultCaptureSample(
      VescFaultCaptureSampleEntity(
        id = 31,
        occurrenceId = "fault-1",
        capturedAtMs = 1_500,
        speed = 12.5,
        dutyCycle = null,
        erpm = null,
        batteryVoltage = null,
        batteryCurrent = null,
        motorCurrent = null,
        tempMosfet = null,
        tempMotor = null,
        pitch = null,
        roll = null,
        balancePitch = null,
        adc1 = null,
        adc2 = null,
        state = 4,
      ),
    )

    assertTrue(encoded.startsWith("""{"occurrenceId":"fault-1","capturedAtMs":1500,"speed":12.5,"""))
    assertTrue(encoded.contains(""""dutyCycle":null"""))
    assertTrue(encoded.endsWith(""""state":4}"""))
    assertTrue("the local row id must never cross the wire", !encoded.contains("\"id\""))
  }

  /**
   * A decoded Board sample is the one thing on the wire the app did not author — it received it.
   * Refusing a non-finite float here would pause every table's backup on a permanent protocol
   * error that no retry can clear, over a reading the firmware itself could not express. Absent is
   * what these nullable columns already mean, so an unusable reading is absent too.
   */
  @Test
  fun `an unusable firmware reading is absent rather than a permanent protocol pause`() {
    val encoded = SyncWire.vescFaultCaptureSample(
      VescFaultCaptureSampleEntity(
        id = 32,
        occurrenceId = "fault-1",
        capturedAtMs = 1_500,
        speed = Double.NaN,
        dutyCycle = Double.POSITIVE_INFINITY,
        erpm = Double.NEGATIVE_INFINITY,
        batteryVoltage = 78.9,
        batteryCurrent = null,
        motorCurrent = null,
        tempMosfet = null,
        tempMotor = null,
        pitch = null,
        roll = null,
        balancePitch = null,
        adc1 = null,
        adc2 = null,
        state = 4,
      ),
    )

    assertTrue(encoded.contains(""""speed":null"""))
    assertTrue(encoded.contains(""""dutyCycle":null"""))
    assertTrue(encoded.contains(""""erpm":null"""))
    assertTrue("a usable reading beside an unusable one still lands", encoded.contains(""""batteryVoltage":78.9"""))
  }

  /**
   * A rule restored without its kind looks configured and fires at the wrong point; a field the
   * server has dropped rejects the entire batch. Both are asserted on the exact bytes.
   */
  @Test
  fun `an alert carries the kind its thresholds are read under`() {
    assertEquals(
      """{"boardId":"board-1","id":"rule-1","controlId":"duty","threshold":70,""" +
        """"thresholdMax":null,"thresholdKind":"configRelative","configFieldId":"tiltback_duty",""" +
        """"thresholdOffset":-5,"thresholdMaxOffset":null,"enabled":true,"soundType":"beep",""" +
        """"repeatEverySeconds":30,"beepCount":2,"source":"preset","createdAt":10,"updatedAt":20}""",
      SyncWire.alert(
        AlertRuleEntity(
          boardId = "board-1",
          id = "rule-1",
          controlId = "duty",
          threshold = 70.0,
          thresholdMax = null,
          thresholdKind = "configRelative",
          configFieldId = "tiltback_duty",
          thresholdOffset = -5.0,
          thresholdMaxOffset = null,
          enabled = true,
          soundType = "beep",
          createdAt = 10,
          repeatEverySeconds = 30,
          beepCount = 2,
          source = "preset",
          updatedAt = 20,
        ),
      ),
    )
  }

  /**
   * Without the stamp the server has nothing to compare, and a re-detection wins or loses
   * arbitrarily against whatever it already holds.
   */
  @Test
  fun `a board warning carries the stamp the server judges two writes on`() {
    assertEquals(
      """{"boardId":"board-1","kind":"cellSpread","severity":"warning","firstDetectedAt":10,""" +
        """"lastDetectedAt":20,"payloadJson":"{}","updatedAt":21}""",
      SyncWire.boardWarning(
        BoardWarningEntity(
          boardId = "board-1",
          kind = "cellSpread",
          severity = "warning",
          firstDetectedAt = 10,
          lastDetectedAt = 20,
          payloadJson = "{}",
          updatedAt = 21,
        ),
      ),
    )
  }

  /**
   * Both columns are gone from the server's schema, which validates a batch whole: sending either
   * one rejects every row in it, not just the field.
   */
  @Test
  fun `the columns the server dropped are not sent at all`() {
    assertTrue(!SyncWire.telemetryFrame(frame()).contains("faultCode"))
    assertTrue(!SyncWire.telemetryMinuteBucket(bucket(sampleCount = 1)).contains("faultCount"))
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
