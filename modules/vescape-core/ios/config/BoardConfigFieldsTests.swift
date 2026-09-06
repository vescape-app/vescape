import XCTest

@testable import VescapeCore

/// Every field in `BoardConfigFlagField` and `BoardConfigNumberField`, resolved against the real `settings.xml` of each Refloat
/// version we support. The fixtures are the firmware's own files, taken from the Refloat repository
/// tags, so a field renamed or retyped upstream fails here rather than on a rider's board.
///
/// They are stored zlib-compressed and handed to the parser exactly as they arrive, which is also how
/// a board sends them: `RefloatConfigSchemaParser.normalizeXmlBytes` inflates the stream itself, so
/// the fixture exercises the real entry point rather than a pre-decompressed shortcut.
///
/// `1.1.x` is one fixture on purpose: v1.1.0, v1.1.1 and v1.1.2 ship byte-identical XML.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/BoardConfigFieldsTest.kt
final class BoardConfigFieldsTests: XCTestCase {
  private let versions = ["1.0.0", "1.1.x", "1.2.x", "1.3.0-beta1"]

  /// The shared fixture corpus, located relative to this file so no resource bundling is needed —
  /// the `BatterySocEstimatorTests` pattern.
  private func schema(_ version: String) throws -> RefloatConfigSchema {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // config
      .deletingLastPathComponent()  // ios
      .deletingLastPathComponent()  // vescape-core
      .deletingLastPathComponent()  // modules
      .deletingLastPathComponent()  // repo root
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

  /// Refloat declares its on/off params as single-byte numbers, never as a schema `bool`. This is the
  /// assumption `encodeFlag` and `BoardConfigValues.flag(_:)` are built on, so it is asserted rather
  /// than trusted: a widened field would silently change the decoded representation.
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

  /// The regression this whole seam exists for: rebasing a flag must produce the exact runtime type
  /// the decoder produces, or the config-change notice reports the rider's own tap as an outside edit
  /// forever — `Off -> 0`, a `Bool` compared against a `Double`.
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
          values.withFlag(field, false),
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

  /// Zeroed bytes decode to `off`, so the accessor must answer `false` — not nil, not `0.0`.
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
    XCTAssertEqual(values.withFlag(.ledsOn, true)?.flag(.ledsOn), true)
  }

  /// A number field that stops resolving does not misreport, it stops evaluating — a Board Warning
  /// quietly never fires again. Rules read finite numbers, so the decoded type is asserted too.
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

  /// A field no schema carries stays absent: adding the key would itself register as a change.
  func testWithFlagRefusesAFieldNeitherSchemaNorValuesKnow() {
    let values = BoardConfigValues(
      boardId: "board",
      refloatBaseVersion: "1.1.x",
      capturedAtMs: 0,
      freshness: .lastKnown,
      values: [:],
      writeBase: nil
    )
    XCTAssertNil(values.withFlag(.ledsOn, true))
  }
}
