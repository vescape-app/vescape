import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/BoardConfigFieldsTest.kt
final class BoardConfigFieldsTests: XCTestCase {
  private let versions = ["1.0.0", "1.1.x", "1.2.x", "1.2.1", "1.3.0-beta1", "1.3.0"]

  private func schema(_ version: String) throws -> RefloatConfigSchema {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let data = try Data(
      contentsOf: root.appendingPathComponent(
        "shared/fixtures/refloat-schema/settings-\(version).xml.zlib"
      )
    )
    return try RefloatConfigSchemaParser.parse([UInt8](data))
  }

  func testEveryFlagFieldExistsInEverySupportedRefloatVersion() throws {
    for version in versions {
      let byId = Dictionary(
        uniqueKeysWithValues: try schema(version).fields.map { ($0.id, $0) }
      )
      let ids = BoardConfigFlagField.allCases.map(\.id) + BoardConfigNumberField.allCases.map(\.id)
      for id in ids {
        XCTAssertNotNil(byId[id], "Refloat \(version) has no field \(id)")
      }
    }
  }

  func testFlagFieldsAreSingleByteInEverySupportedRefloatVersion() throws {
    for version in versions {
      let byId = Dictionary(
        uniqueKeysWithValues: try schema(version).fields.map { ($0.id, $0) }
      )
      for field in BoardConfigFlagField.allCases {
        let type = try XCTUnwrap(byId[field.id]).type
        XCTAssertEqual(type.byteSize, 1, "Refloat \(version) widened \(field.id) to \(type)")
      }
    }
  }

  func testRebasedFlagKeepsTheDecodedRuntimeTypeAndRaisesNoDiff() throws {
    for version in versions {
      let schema = try schema(version)
      let rawConfig = [UInt8](
        repeating: 0,
        count: schema.fields.map { $0.offset + $0.type.byteSize }.max() ?? 0
      )
      let decoded = RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: rawConfig)
      let values = BoardConfigValues(
        boardId: "board",
        refloatBaseVersion: version,
        capturedAtMs: 0,
        freshness: .fresh,
        values: decoded,
        writeBase: BoardConfigWriteBase(schema: schema, rawConfig: rawConfig, packageSignature: 0)
      )

      for field in BoardConfigFlagField.allCases {
        let rebased = try XCTUnwrap(
          try values.withFlag(field, false),
          "Refloat \(version) cannot rebase \(field.id)"
        )
        let rebasedValue = try XCTUnwrap(rebased.values[field.id])
        let decodedValue = try XCTUnwrap(decoded[field.id])
        XCTAssertEqual(
          String(describing: type(of: rebasedValue)),
          String(describing: type(of: decodedValue)),
          "Refloat \(version) rebased \(field.id) as \(type(of: rebasedValue))"
        )
        XCTAssertTrue(
          BoardConfigChangeNotice.diff(old: rebased.values, new: decoded, schema: schema).isEmpty,
          "Refloat \(version) rebasing \(field.id) to its decoded value reported a change"
        )
      }
    }
  }

  func testFlagReadsTheNumericRepresentationRefloatActuallyUses() throws {
    let schema = try schema("1.1.x")
    let rawConfig = [UInt8](
      repeating: 0,
      count: schema.fields.map { $0.offset + $0.type.byteSize }.max() ?? 0
    )
    let values = BoardConfigValues(
      boardId: "board",
      refloatBaseVersion: "1.1.x",
      capturedAtMs: 0,
      freshness: .fresh,
      values: RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: rawConfig),
      writeBase: BoardConfigWriteBase(schema: schema, rawConfig: rawConfig, packageSignature: 0)
    )
    XCTAssertEqual(values.flag(.ledsOn), false)
    XCTAssertEqual(try values.withFlag(.ledsOn, true)?.flag(.ledsOn), true)
  }

  func testWithLightsPatchesTheWriteBaseBytesInEverySupportedRefloatVersion() throws {
    for version in versions {
      let schema = try schema(version)
      let rawConfig = [UInt8](
        repeating: 0,
        count: schema.fields.map { $0.offset + $0.type.byteSize }.max() ?? 0
      )
      let values = BoardConfigValues(
        boardId: "board",
        refloatBaseVersion: version,
        capturedAtMs: 0,
        freshness: .fresh,
        values: RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: rawConfig),
        writeBase: BoardConfigWriteBase(schema: schema, rawConfig: rawConfig, packageSignature: 0)
      )

      let lit = try XCTUnwrap(try values.withLights(enabled: true, headlightsEnabled: true))
      let reread = RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: try XCTUnwrap(lit.writeBase).rawConfig)

      for field in BoardConfigFlagField.allCases {
        XCTAssertEqual(lit.withValues(reread).flag(field), true, "Refloat \(version) write base keeps \(field.id) off")
      }
      XCTAssertTrue(
        BoardConfigChangeNotice.diff(old: lit.values, new: reread, schema: schema).isEmpty,
        "Refloat \(version) decoded values disagree with the patched write base"
      )
    }
  }

  func testEveryNumberFieldDecodesAsAFiniteNumberInEverySupportedRefloatVersion() throws {
    for version in versions {
      let schema = try schema(version)
      let rawConfig = [UInt8](
        repeating: 0,
        count: schema.fields.map { $0.offset + $0.type.byteSize }.max() ?? 0
      )
      let values = BoardConfigValues(
        boardId: "board",
        refloatBaseVersion: version,
        capturedAtMs: 0,
        freshness: .fresh,
        values: RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: rawConfig),
        writeBase: BoardConfigWriteBase(schema: schema, rawConfig: rawConfig, packageSignature: 0)
      )
      for field in BoardConfigNumberField.allCases {
        XCTAssertNotNil(
          values.number(field),
          "Refloat \(version) does not decode \(field.id) as a number"
        )
      }
    }
  }

  func testWithFlagRefusesAFieldNeitherSchemaNorValuesKnow() {
    let values = BoardConfigValues(
      boardId: "board",
      refloatBaseVersion: "1.1.x",
      capturedAtMs: 0,
      freshness: .lastKnown,
      values: [:],
      writeBase: nil
    )
    XCTAssertNil(try values.withFlag(.ledsOn, true))
  }
}
