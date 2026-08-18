import XCTest
@testable import VescapeCore

/// Board Config Values contract (#393): the decoded map spans the whole schema in real types, a field
/// the bytes cannot supply is absent rather than guessed, and a cached object comes back provisional
/// with its bools intact.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/BoardConfigValuesTest.kt
final class BoardConfigValuesTests: XCTestCase {
  private func schema(_ fields: [RefloatConfigSchemaField]) -> RefloatConfigSchema {
    RefloatConfigSchema(hash: "hash", fields: fields)
  }

  private func field(
    _ id: String,
    _ type: RefloatConfigValueType,
    offset: Int,
    scale: Double? = nil
  ) -> RefloatConfigSchemaField {
    RefloatConfigSchemaField(id: id, type: type, label: id, unit: nil, min: nil, max: nil, offset: offset, scale: scale)
  }

  func testDecodesEveryFieldKeepingBoolsBool() {
    let schema = schema([
      field("kp", .float32, offset: 0),
      field("fault_moving_fault_disabled", .bool, offset: 4),
      field("tiltback_duty", .uint8, offset: 5),
    ])
    var bytes = [UInt8](repeating: 0, count: 6)
    let kp = Float(4.5).bitPattern
    bytes[0] = UInt8(kp >> 24 & 0xff)
    bytes[1] = UInt8(kp >> 16 & 0xff)
    bytes[2] = UInt8(kp >> 8 & 0xff)
    bytes[3] = UInt8(kp & 0xff)
    bytes[4] = 1
    bytes[5] = 85

    let values = RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: bytes)

    XCTAssertEqual(values["kp"] as? Double, 4.5)
    // A bool field stays a Bool — the whole-schema map never coerces to 1.0 / 0.0.
    XCTAssertEqual(values["fault_moving_fault_disabled"] as? Bool, true)
    XCTAssertNil(values["fault_moving_fault_disabled"] as? Double)
    XCTAssertEqual(values["tiltback_duty"] as? Double, 85.0)
  }

  func testTruncatedAndUnparseableFieldsAreMissingNotValues() {
    let schema = schema([
      field("present", .uint8, offset: 0),
      // Past the end of the raw config: the `offset + byteSize` precondition drops it.
      field("truncated", .float32, offset: 1),
      // A scaled field with no scale cannot decode; one bad field must not take the map down.
      field("unparseable", .float32Scaled, offset: 0),
    ])

    let values = RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: [7])

    XCTAssertEqual(values["present"] as? Double, 7.0)
    XCTAssertNil(values["truncated"])
    XCTAssertNil(values["unparseable"])
  }

  func testNonFiniteDecodeIsMissingNotAValue() {
    let schema = schema([field("nan", .float32, offset: 0)])
    let values = RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: [0x7f, 0xc0, 0x00, 0x00])

    // NaN counts as missing: a rule skips an absent field, but would read a NaN as a clean evaluation.
    XCTAssertNil(values["nan"])
  }

  func testFreshValuesRetainWriteBase() {
    let schema = schema([field("kp", .float32, offset: 0)])
    let values = RefloatConfigDecoder.decodeBoardConfigValues(
      schema: schema,
      configBytes: RefloatConfigBytes(confInd: 0, packageSignature: 0xdead_beef, config: [0, 0, 0, 0]),
      boardId: "board-1",
      refloatBaseVersion: "3.0",
      capturedAt: 42
    )

    XCTAssertEqual(values.freshness, .fresh)
    XCTAssertEqual(values.writeBase?.packageSignature, 0xdead_beef)
    XCTAssertEqual(values.writeBase?.rawConfig, [0, 0, 0, 0])
    XCTAssertEqual(values.writeBase?.schema.hash, "hash")
  }

  func testProvisionalRoundTripKeepsTypesAndHasNoWriteBase() {
    let fresh = BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "3.0",
      capturedAtMs: 7,
      freshness: .fresh,
      values: ["tiltback_duty": 0.8, "fault_moving_fault_disabled": true],
      writeBase: nil
    )

    let restored = BoardConfigValues.provisional(
      boardId: "board-1",
      refloatBaseVersion: "3.0",
      capturedAtMs: 7,
      valuesJson: fresh.valuesJson()
    )

    XCTAssertEqual(restored.freshness, .provisional)
    XCTAssertNil(restored.writeBase)
    XCTAssertEqual(restored.number("tiltback_duty"), 0.8)
    // A cached bool must not come back as 1.0.
    XCTAssertEqual(restored.bool("fault_moving_fault_disabled"), true)
    XCTAssertNil(restored.number("fault_moving_fault_disabled"))
  }

  /// The bridge map is the whole JS contract: decoded fields and freshness, never the write base.
  /// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/BoardConfigValuesTest.kt `bridgeMapCarriesValuesAndFreshnessButNoWriteBase`
  func testBridgeMapCarriesValuesAndFreshnessButNoWriteBase() {
    let values = BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "3.0",
      capturedAtMs: 7,
      freshness: .fresh,
      values: ["fault_adc1": 0.8, "fault_moving_fault_disabled": true],
      writeBase: BoardConfigWriteBase(
        schema: schema([field("kp", .float32, offset: 0)]),
        rawConfig: [1, 2, 3, 4],
        packageSignature: 0xdead_beef
      )
    )

    let map = values.toBridgeMap()

    XCTAssertEqual(map["boardId"] as? String, "board-1")
    XCTAssertEqual(map["refloatBaseVersion"] as? String, "3.0")
    XCTAssertEqual(map["capturedAtMs"] as? Int64, 7)
    XCTAssertEqual(map["freshness"] as? String, "fresh")
    let decoded = map["values"] as? [String: Any]
    XCTAssertEqual(decoded?["fault_adc1"] as? Double, 0.8)
    XCTAssertEqual(decoded?["fault_moving_fault_disabled"] as? Bool, true)
    // Raw bytes and package signature stay native — JS never gets a write base.
    XCTAssertNil(map["writeBase"] ?? nil)
    XCTAssertNil(map["rawConfig"] ?? nil)
  }
}
