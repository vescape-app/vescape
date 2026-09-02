import XCTest
import GRDB
@testable import VescapeCore

/// Wire encoding and the bounds it refuses on. The valid/invalid boundary cases mirror the server's
/// own schema (`vescape-server` `src/sync/protocol.ts`), so a row this side accepts is a row that
/// side can store — a batch is whole or refused, and a bad row must never reach transport.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/SyncWireTest.kt
final class SyncWireTests: XCTestCase {
  private func boardRow(
    id: String = "board-1",
    name: String = "Board",
    transport: String? = nil
  ) -> Row {
    Row([
      "id": id,
      "name": name,
      "ble_id": nil,
      "transport": transport,
      "created_at": 10,
      "updated_at": 20,
    ])
  }

  private func frameRow(boardId: String? = "board-1", speed: Int64? = 100) -> Row {
    var values: [String: DatabaseValueConvertible?] = [
      "id": 5,
      "board_id": boardId,
      "captured_at_ms": 1_000,
      "elapsed_realtime_ms": 500,
      "flags": 1,
      "changed_mask_1": 3,
      "changed_mask_2": 0,
      "speed_centi_kmh": speed,
    ]
    for column in [
      "can_id", "battery_voltage_mv", "motor_current_ma", "battery_current_ma", "duty_permille",
      "pitch_centi_deg", "roll_centi_deg", "balance_pitch_centi_deg", "balance_current_ma", "erpm",
      "state", "switch_state", "adc1_milli", "adc2_milli", "odometer_cm", "temp_mosfet_deci_c",
      "temp_motor_deci_c", "latitude_e7", "longitude_e7", "gps_speed_centi_mps",
      "bearing_centi_deg", "accuracy_cm", "altitude_cm", "location_timestamp_ms",
    ] {
      values[column] = nil
    }
    return Row(values)
  }

  func testABoardEncodesExactlyTheDeclaredFieldsNullsIncluded() throws {
    XCTAssertEqual(
      try SyncWire.board(boardRow()),
      #"{"id":"board-1","name":"Board","bleId":null,"transport":null,"createdAt":10,"updatedAt":20}"#
    )
  }

  /// iOS is the platform that stores Board Transport on the Board, and the server declares the field
  /// for exactly that — dropping it would lose the Board Link's transport on restore.
  func testABoardCarriesTheTransportOnlyIosStores() throws {
    let encoded = try SyncWire.board(boardRow(transport: "direct"))
    XCTAssertTrue(encoded.contains(#""transport":"direct""#))
  }

  /// "Cleared" and "not mentioned" are different intents, and only one survives a missing key.
  func testNullableColumnsAreExplicitNullsNeverOmittedKeys() throws {
    let encoded = try SyncWire.telemetryFrame(frameRow(speed: nil))
    XCTAssertTrue(encoded.contains(#""speedCentiKmh":null"#))
  }

  func testTextIsEscapedSoTheBodyStaysParseable() throws {
    let encoded = try SyncWire.board(boardRow(name: "He said \"go\"\n"))
    XCTAssertTrue(encoded.contains(#"\"go\""#))
    XCTAssertTrue(encoded.contains(#"\n"#))
  }

  func testAKeyAtTheLengthLimitIsValidAndOneOverIsRefused() throws {
    _ = try SyncWire.board(boardRow(id: String(repeating: "b", count: maxSyncKeyLength)))
    XCTAssertThrowsError(
      try SyncWire.board(boardRow(id: String(repeating: "b", count: maxSyncKeyLength + 1)))
    )
  }

  /// The server compiles `value.length <= 128`, which counts UTF-16 code units — so an emoji is two.
  /// Swift's `count` would see 64 characters here and let a key through that the server refuses.
  func testKeyLengthIsMeasuredInUtf16CodeUnitsLikeTheServer() {
    let emoji = String(repeating: "🛹", count: 65)
    XCTAssertEqual(emoji.count, 65)
    XCTAssertEqual(emoji.utf16.count, 130)
    XCTAssertThrowsError(try SyncWire.board(boardRow(id: emoji)))
  }

  func testAnEmptyKeyIsRefusedWhereTheServerNamesIt() throws {
    XCTAssertThrowsError(try SyncWire.board(boardRow(id: "")))
    _ = try SyncWire.appSetting(
      Row(["key": "mapStyleKey", "value_json": "\"\"", "updated_at": 1])
    )
  }

  /// A sample that names no Board has nowhere to go on the server, so it never reaches transport.
  func testAFrameWithoutABoardIsAProtocolError() {
    XCTAssertThrowsError(try SyncWire.telemetryFrame(frameRow(boardId: nil))) { error in
      XCTAssertEqual((error as? SyncProtocolError)?.field, "boardId")
    }
  }

  func testIntegerBoundsAreEnforcedAtTheEdge() throws {
    _ = try SyncWire.telemetryFrame(frameRow(speed: Int64(Int32.max)))
    XCTAssertThrowsError(try SyncRowWriter(.telemetryFrames).int32("speedCentiKmh", 2_147_483_648))
  }

  func testANonFiniteNumberIsRefusedBecauseJsonCannotExpressIt() {
    XCTAssertThrowsError(try SyncRowWriter(.alerts).number("threshold", Double.nan)) { error in
      XCTAssertEqual((error as? SyncProtocolError)?.field, "threshold")
    }
  }

  /// An action reads like the row it names: flat identity fields, not a nested envelope.
  func testADeleteActionExpandsIntoTheIdentityItsTargetDeclares() throws {
    XCTAssertEqual(
      try SyncWire.deleteAction(
        Row(["target": "boardSetting", "board_id": "board-1", "key": "transport", "deleted_at": 9])
      ),
      #"{"target":"boardSetting","boardId":"board-1","key":"transport","deletedAt":9}"#
    )
    XCTAssertEqual(
      try SyncWire.deleteAction(
        Row(["target": "tuneProfile", "board_id": nil, "key": "profile-1", "deleted_at": 4])
      ),
      #"{"target":"tuneProfile","id":"profile-1","deletedAt":4}"#
    )
    XCTAssertThrowsError(
      try SyncWire.deleteAction(
        Row(["target": "somethingElse", "board_id": nil, "key": "x", "deleted_at": 1])
      )
    )
  }

  // MARK: - Columns the server has dropped

  /// Both columns went away when VESC faults became Board-owned evidence in their own tables
  /// (ADR-0037). The server's schema is strict, so a field it no longer declares does not get
  /// ignored — it refuses the whole Sync Batch.
  func testRetiredFaultFieldsAreNoLongerSent() throws {
    XCTAssertFalse(try SyncWire.telemetryFrame(frameRow()).contains("faultCode"))
    XCTAssertFalse(try SyncWire.telemetryMinuteBucket(bucketRow()).contains("faultCount"))
  }

  private func bucketRow() -> Row {
    var values: [String: DatabaseValueConvertible?] = [
      "board_id": "board-1",
      "bucket_start_ms": 60_000,
      "updated_at": 61_000,
      "sample_count": 2,
      "first_sample_at_ms": 60_000,
      "last_sample_at_ms": 60_500,
      "sum_abs_speed_centi_kmh": 10,
      "max_abs_speed_centi_kmh": 9,
      "max_motor_current_abs_ma": 1,
      "max_battery_current_abs_ma": 1,
      "battery_used_wh_milli": 1,
      "battery_regen_wh_milli": 0,
      "max_duty_abs_permille": 5,
      "gps_point_count": 0,
      "precise_gps_point_count": 0,
      "gps_distance_cm": 0,
    ]
    for column in [
      "moving_speed_sample_count", "sum_moving_abs_speed_centi_kmh", "min_battery_voltage_mv",
      "first_odometer_cm", "last_odometer_cm", "max_gps_speed_centi_mps", "max_temp_mosfet_deci_c",
      "max_temp_motor_deci_c", "first_latitude_e7", "first_longitude_e7", "first_moving_at_ms",
      "last_moving_at_ms",
    ] {
      values[column] = nil
    }
    return Row(values)
  }

  // MARK: - Alert Rules

  /// A rule that travels without its kind and offsets comes back looking configured and firing at
  /// the wrong point, which is worse than losing it.
  func testAnAlertRuleCarriesTheWholeThresholdRuleNotJustTheNumber() throws {
    let encoded = try SyncWire.alert(
      Row([
        "board_id": "board-1", "id": "rule-1", "control_id": "duty", "threshold": 70.0,
        "threshold_max": nil, "threshold_kind": "configRelative", "config_field_id": "tiltback_duty",
        "threshold_offset": -5.0, "threshold_max_offset": nil, "enabled": 1, "sound_type": "beep",
        "repeat_every_seconds": 30, "beep_count": 2, "source": "preset", "created_at": 1,
        "updated_at": 2,
      ])
    )

    XCTAssertEqual(
      encoded,
      #"{"boardId":"board-1","id":"rule-1","controlId":"duty","threshold":70,"thresholdMax":null,"# +
        #""thresholdKind":"configRelative","configFieldId":"tiltback_duty","thresholdOffset":-5,"# +
        #""thresholdMaxOffset":null,"enabled":true,"soundType":"beep","repeatEverySeconds":30,"# +
        #""beepCount":2,"source":"preset","createdAt":1,"updatedAt":2}"#
    )
  }

  /// A Board Warning's detection time and its Change Timestamp answer different questions: a
  /// re-triage that lowers a severity changes the row without the Board being seen in that state
  /// again, and judging arrivals on the detection time drops exactly those edits.
  func testABoardWarningCarriesItsChangeTimestampAsWellAsItsDetectionTime() throws {
    XCTAssertEqual(
      try SyncWire.boardWarning(
        Row([
          "board_id": "board-1", "kind": "batteryImbalance", "severity": "warning",
          "first_detected_at": 1, "last_detected_at": 2, "payload_json": "{}", "updated_at": 7,
        ])
      ),
      #"{"boardId":"board-1","kind":"batteryImbalance","severity":"warning","firstDetectedAt":1,"# +
        #""lastDetectedAt":2,"payloadJson":"{}","updatedAt":7}"#
    )
  }

  // MARK: - VESC Fault Evidence

  func testAFaultOccurrenceEncodesExactlyTheDeclaredFields() throws {
    XCTAssertEqual(
      try SyncWire.vescFaultOccurrence(
        Row([
          "id": "fault-1", "board_id": "board-1", "code": 9, "occurred_at": 1_000,
          "last_observed_at": 4_000, "cleared_at": nil, "dismissed": 1, "updated_at": 5_000,
          "sync_seq": 3,
        ])
      ),
      #"{"id":"fault-1","boardId":"board-1","code":9,"occurredAtMs":1000,"lastObservedAtMs":4000,"# +
        #""clearedAtMs":null,"dismissed":true,"updatedAt":5000}"#
    )
  }

  func testAFaultCaptureEncodesExactlyTheDeclaredFields() throws {
    XCTAssertEqual(
      try SyncWire.vescFaultCapture(
        Row([
          "occurrence_id": "fault-1", "board_id": "board-1", "started_at": 900, "opened_at": 1_000,
          "sample_count": 3, "sync_seq": 2,
        ])
      ),
      #"{"occurrenceId":"fault-1","boardId":"board-1","startedAtMs":900,"openedAtMs":1000,"sampleCount":3}"#
    )
  }

  /// The local autoincrement id restarts on a fresh install, so it never crosses the wire: identity
  /// is `(occurrenceId, capturedAtMs)`. A field the firmware never sent is null, never zero.
  func testAFaultCaptureSampleKeepsItsLocalIdHomeAndSendsAbsentFieldsAsNull() throws {
    var values: [String: DatabaseValueConvertible?] = [
      "id": 41,
      "occurrence_id": "fault-1",
      "captured_at": 1_000,
      "speed": 12.5,
      "state": 4,
    ]
    for column in [
      "duty_cycle", "erpm", "battery_voltage", "battery_current", "motor_current", "temp_mosfet",
      "temp_motor", "pitch", "roll", "balance_pitch", "adc1", "adc2",
    ] {
      values[column] = nil
    }

    XCTAssertEqual(
      try SyncWire.vescFaultCaptureSample(Row(values)),
      #"{"occurrenceId":"fault-1","capturedAtMs":1000,"speed":12.5,"dutyCycle":null,"erpm":null,"# +
        #""batteryVoltage":null,"batteryCurrent":null,"motorCurrent":null,"tempMosfet":null,"# +
        #""tempMotor":null,"pitch":null,"roll":null,"balancePitch":null,"adc1":null,"adc2":null,"# +
        #""state":4}"#
    )
  }

  /// A decoded Board sample is the one thing on the wire the app did not author — it received it.
  /// Refusing a non-finite float here would pause every table's backup on a permanent protocol
  /// error that no retry can clear, over a reading the firmware itself could not express. Absent is
  /// what these nullable columns already mean, so an unusable reading is absent too.
  func testAnUnusableFirmwareReadingIsAbsentRatherThanAPermanentProtocolPause() throws {
    var values: [String: DatabaseValueConvertible?] = [
      "id": 42,
      "occurrence_id": "fault-1",
      "captured_at": 1_000,
      "speed": Double.nan,
      "duty_cycle": Double.infinity,
      "erpm": -Double.infinity,
      "battery_voltage": 78.9,
      "state": 4,
    ]
    for column in [
      "battery_current", "motor_current", "temp_mosfet", "temp_motor", "pitch", "roll",
      "balance_pitch", "adc1", "adc2",
    ] {
      values[column] = nil
    }

    let encoded = try SyncWire.vescFaultCaptureSample(Row(values))

    XCTAssertTrue(encoded.contains(#""speed":null"#))
    XCTAssertTrue(encoded.contains(#""dutyCycle":null"#))
    XCTAssertTrue(encoded.contains(#""erpm":null"#))
    XCTAssertTrue(encoded.contains(#""batteryVoltage":78.9"#), "a usable reading beside an unusable one still lands")
  }
}
