import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/RefloatConfigDecoderTest.kt
final class RefloatConfigDecoderTests: XCTestCase {
  func testDecodesBoardConfigValuesWithSchemaAndWriteBase() throws {
    let schema = RefloatConfigSchema(
      hash: "schema-hash",
      fields: [
        RefloatConfigSchemaField(id: "kp", type: .float32, label: "Angle P", unit: nil, min: 0, max: 100, offset: 0),
        RefloatConfigSchemaField(id: "kp2", type: .float32, label: "Rate P", unit: nil, min: 0, max: 5, offset: 4),
        RefloatConfigSchemaField(id: "unused", type: .int32, label: "Unused", unit: nil, min: nil, max: nil, offset: 8),
      ]
    )
    let bytes = float32Bytes(26.0) + float32Bytes(0.9) + int32Bytes(123)

    let values = try RefloatConfigDecoder.decodeBoardConfigValues(
      schema: schema,
      configBytes: RefloatConfigBytes(confInd: 0, packageSignature: 0x1234, config: bytes),
      boardId: "board-1",
      refloatBaseVersion: "1.3",
      capturedAt: 100
    )

    XCTAssertEqual("schema-hash", values.schemaHash)
    XCTAssertEqual(12, values.writeBase?.rawConfig.count)
    let angleP = try XCTUnwrap(values.values["kp"] as? Double)
    let rateP = try XCTUnwrap(values.values["kp2"] as? Double)
    let unused = try XCTUnwrap(values.values["unused"] as? Double)
    XCTAssertEqual(26.0, angleP, accuracy: 0.001)
    XCTAssertEqual(0.9, rateP, accuracy: 0.001)
    XCTAssertEqual(123.0, unused, accuracy: 0.001)
  }

  func testRejectsTruncatedConfig() {
    let schema = RefloatConfigSchema(
      hash: "schema-hash",
      fields: [
        RefloatConfigSchemaField(id: "kp", type: .float32, label: "Angle P", unit: nil, min: 0, max: 100, offset: 0),
      ]
    )

    XCTAssertThrowsError(
      try RefloatConfigDecoder.decodeBoardConfigValues(
        schema: schema,
        configBytes: RefloatConfigBytes(confInd: 0, packageSignature: 0, config: [1, 2]),
        boardId: nil,
        refloatBaseVersion: nil,
        capturedAt: 100
      )
    )
  }

  private func float32Bytes(_ value: Float) -> [UInt8] {
    int32Bytes(Int32(bitPattern: value.bitPattern))
  }

  private func int32Bytes(_ value: Int32) -> [UInt8] {
    let raw = UInt32(bitPattern: value)
    return [
      UInt8((raw >> 24) & 0xff),
      UInt8((raw >> 16) & 0xff),
      UInt8((raw >> 8) & 0xff),
      UInt8(raw & 0xff),
    ]
  }
}
