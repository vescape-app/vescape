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
      "temp_motor_deci_c", "fault_code", "latitude_e7", "longitude_e7", "gps_speed_centi_mps",
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
}
