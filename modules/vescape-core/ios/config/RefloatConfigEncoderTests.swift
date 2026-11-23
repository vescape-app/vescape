import XCTest
@testable import VescapeCore

final class RefloatConfigEncoderTests: XCTestCase {

  func testRoundTripPreservesAllBytes() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    let decoded = decodeAllFields(schema, raw)
    let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: decoded)
    XCTAssertEqual(raw, reEncoded, "Round-trip must produce identical bytes")
  }

  func testModifyingSingleFieldChangesOnlyTargetBytes() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    let modified = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: ["f32": 99.0])

    let f32Field = schema.fields.first { $0.id == "f32" }!
    for i in raw.indices {
      if i >= f32Field.offset && i < f32Field.offset + f32Field.type.byteSize { continue }
      XCTAssertEqual(raw[i], modified[i], "Byte at offset \(i) should be unchanged")
    }
    let newVal = Float(bitPattern: readUInt32(modified, 0))
    XCTAssertEqual(99.0, newVal, accuracy: 0.001)
  }

  func testOutputLengthMatchesInput() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    let result = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: ["f32": 1.0])
    XCTAssertEqual(raw.count, result.count)
  }

  func testMissingFieldsInMapArePreserved() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    let result = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: [:])
    XCTAssertEqual(raw, result, "Empty field map = no changes")
  }

  func testUnknownFieldRejectsWholeWrite() {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    assertInvalid(schema, raw, ["u8": 7.0, "nonexistent_field": 42.0])
  }

  func testValuesOutsideWireRangeAreRejected() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    let outOfRange: [(String, Double)] = [
      ("f16_scaled", 327.68),
      ("f16_scaled", -327.69),
      ("f32_scaled", 2_147_483.648),
      ("i32", 2_147_483_648),
      ("u32", -1),
      ("u32", 4_294_967_296),
      ("i16", -32769),
      ("u16", 65536),
      ("i8", 128),
      ("u8", 256),
      ("u8", -1),
      ("f32", 1e39),
      ("f32_auto", -1e39),
    ]
    for (fieldId, value) in outOfRange {
      assertInvalid(schema, raw, [fieldId: value])
    }
    let edges = try RefloatConfigEncoder.encode(
      schema: schema,
      rawConfig: raw,
      fields: ["f16_scaled": -327.68, "u8": 255.0, "u32": 4_294_967_295.0, "i8": -128.0]
    )
    let decoded = decodeAllFields(schema, edges)
    XCTAssertEqual(decoded["f16_scaled"] as? Double ?? 0, -327.68, accuracy: 1e-9)
    XCTAssertEqual(decoded["u8"] as? Double, 255)
    XCTAssertEqual(decoded["u32"] as? Double, 4_294_967_295)
    XCTAssertEqual(decoded["i8"] as? Double, -128)
  }

  func testNonFiniteValuesAreRejected() {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    for fieldId in ["f32", "f32_auto", "f32_scaled", "f16_scaled", "u8"] {
      for value in [Double.nan, Double.infinity, -Double.infinity] {
        assertInvalid(schema, raw, [fieldId: value])
      }
    }
  }

  func testWrongValueTypesAreRejected() {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    assertInvalid(schema, raw, ["u8": true])
    assertInvalid(schema, raw, ["u8": NSNumber(value: true)])
    assertInvalid(schema, raw, ["f32": "1.0"])
    assertInvalid(schema, raw, ["bool_true": 2.0])
    assertInvalid(schema, raw, ["bool_true": "yes"])
  }

  func testBoolAcceptsBooleansAndZeroOrOne() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    let encoded = try RefloatConfigEncoder.encode(
      schema: schema,
      rawConfig: raw,
      fields: ["bool_true": false, "bool_false": 1]
    )
    let decoded = decodeAllFields(schema, encoded)
    XCTAssertEqual(decoded["bool_true"] as? Bool, false)
    XCTAssertEqual(decoded["bool_false"] as? Bool, true)
  }

  func testIntegersRoundHalfUp() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    let encoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: ["u8": 7.5, "i16": -2.5])
    let decoded = decodeAllFields(schema, encoded)
    XCTAssertEqual(decoded["u8"] as? Double, 8)
    XCTAssertEqual(decoded["i16"] as? Double, -2)
  }

  func testFloat32RoundTrip() throws {
    let schema = RefloatConfigSchema(hash: "t", fields: [field("v", .float32, offset: 0)])
    for value in [0.0, 1.0, -1.0, 3.14, -999.99, Double(Float.greatestFiniteMagnitude)] {
      let raw = float32Bytes(Float(value))
      let decoded = decodeAllFields(schema, raw)
      let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: decoded)
      XCTAssertEqual(raw, reEncoded, "FLOAT32 round-trip for \(value)")
    }
  }

  func testFloat32ScaledRoundTrip() throws {
    let schema = RefloatConfigSchema(hash: "t", fields: [field("v", .float32Scaled, offset: 0, scale: 1000.0)])
    for rawInt in [Int32(0), 1, -1, 1500, -2500, Int32.max, Int32.min] {
      let raw = int32Bytes(rawInt)
      let decoded = decodeAllFields(schema, raw)
      let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: decoded)
      XCTAssertEqual(raw, reEncoded, "FLOAT32_SCALED round-trip for raw=\(rawInt)")
    }
  }

  func testFloat32AutoRoundTrip() throws {
    let schema = RefloatConfigSchema(hash: "t", fields: [field("v", .float32Auto, offset: 0)])
    for value: Float in [0.0, 1.0, -1.0, 0.5, 3.0, 100.0, -500.0, 12345.678, 0.001] {
      let raw = float32Bytes(value)
      let decoded = decodeAllFields(schema, raw)
      let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: decoded)
      XCTAssertEqual(raw, reEncoded, "FLOAT32_AUTO round-trip for \(value)")
    }
  }

  func testFloat32AutoMatchesVescByteVectors() throws {
    let schema = RefloatConfigSchema(hash: "t", fields: [field("v", .float32Auto, offset: 0)])
    let vectors: [(Double, UInt32)] = [
      (0.0, 0x0000_0000),
      (0.5, 0x3F00_0000),
      (1.0, 0x3F80_0000),
      (3.0, 0x4040_0000),
      (30.0, 0x41F0_0000),
      (100.0, 0x42C8_0000),
      (-2.5, 0xC020_0000),
    ]
    for (value, expected) in vectors {
      let encoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: [0, 0, 0, 0], fields: ["v": value])
      XCTAssertEqual(expected, readUInt32(encoded, 0), "FLOAT32_AUTO bytes for \(value)")
    }
  }

  func testFloat16ScaledRoundTrip() throws {
    let schema = RefloatConfigSchema(hash: "t", fields: [field("v", .float16Scaled, offset: 0, scale: 100.0)])
    for rawShort in [Int16(0), 1, -1, 325, -500, Int16.max, Int16.min] {
      let raw = int16Bytes(rawShort)
      let decoded = decodeAllFields(schema, raw)
      let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: decoded)
      XCTAssertEqual(raw, reEncoded, "FLOAT16_SCALED round-trip for raw=\(rawShort)")
    }
  }

  func testIntegerTypesRoundTrip() throws {
    let cases: [(RefloatConfigValueType, [UInt8])] = [
      (.int32, int32Bytes(-42)),
      (.uint32, int32Bytes(Int32(bitPattern: 0x8000_0001))),
      (.int16, int16Bytes(-100)),
      (.uint16, int16Bytes(Int16(bitPattern: 60000))),
      (.int8, [UInt8(bitPattern: -5)]),
      (.uint8, [200]),
    ]
    for (type, rawBytes) in cases {
      let schema = RefloatConfigSchema(hash: "t", fields: [field("v", type, offset: 0)])
      let decoded = decodeAllFields(schema, rawBytes)
      let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: rawBytes, fields: decoded)
      XCTAssertEqual(rawBytes, reEncoded, "\(type) round-trip")
    }
  }

  func testBoolRoundTrip() throws {
    let schema = RefloatConfigSchema(hash: "t", fields: [field("v", .bool, offset: 0)])
    for rawByte in [UInt8(0), 1, 255] {
      let raw = [rawByte]
      let decoded = decodeAllFields(schema, raw)
      let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: decoded)
      if rawByte == 0 {
        XCTAssertEqual(0, reEncoded[0], "BOOL false round-trip")
      } else {
        XCTAssertNotEqual(0, reEncoded[0], "BOOL true round-trip")
      }
    }
  }

  func testLargeConfigBlobPreservesUnknownBytes() throws {
    let schema = RefloatConfigSchema(hash: "t", fields: [field("v", .float32, offset: 10)])
    var raw = (0..<256).map { UInt8($0 % 256) }
    let f = float32Bytes(3.14)
    for i in 0..<4 { raw[10 + i] = f[i] }

    let decoded = decodeAllFields(schema, raw)
    let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: decoded)
    XCTAssertEqual(raw, reEncoded)
  }

  func testMultiFieldModificationOnlyAffectsTargetOffsets() throws {
    let schema = allTypeSchema()
    var raw = (0..<64).map { UInt8($0 * 7 % 256) }
    let validRaw = buildRawConfig(schema)
    for i in 0..<min(validRaw.count, raw.count) { raw[i] = validRaw[i] }

    let modifications: [String: Any] = ["f32": 1.0, "i16": -50.0, "u8": 128.0]
    let result = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: modifications)

    var modifiedOffsets = Set<Int>()
    for fieldId in modifications.keys {
      let f = schema.fields.first { $0.id == fieldId }!
      for i in f.offset..<(f.offset + f.type.byteSize) { modifiedOffsets.insert(i) }
    }
    for i in raw.indices where !modifiedOffsets.contains(i) {
      XCTAssertEqual(raw[i], result[i], "Untouched byte at offset \(i)")
    }
  }

  private func field(_ id: String, _ type: RefloatConfigValueType, offset: Int, scale: Double? = nil) -> RefloatConfigSchemaField {
    RefloatConfigSchemaField(id: id, type: type, label: id, unit: nil, min: nil, max: nil, offset: offset, scale: scale)
  }

  private func allTypeSchema() -> RefloatConfigSchema {
    var offset = 0
    func f(_ id: String, _ type: RefloatConfigValueType, _ scale: Double? = nil) -> RefloatConfigSchemaField {
      let field = RefloatConfigSchemaField(id: id, type: type, label: id, unit: nil, min: nil, max: nil, offset: offset, scale: scale)
      offset += type.byteSize
      return field
    }
    return RefloatConfigSchema(
      hash: "test",
      fields: [
        f("f32", .float32),
        f("f32_scaled", .float32Scaled, 1000.0),
        f("f32_auto", .float32Auto),
        f("f16_scaled", .float16Scaled, 100.0),
        f("i32", .int32),
        f("u32", .uint32),
        f("i16", .int16),
        f("u16", .uint16),
        f("i8", .int8),
        f("u8", .uint8),
        f("bool_true", .bool),
        f("bool_false", .bool),
      ]
    )
  }

  private func buildRawConfig(_ schema: RefloatConfigSchema) -> [UInt8] {
    var buf: [UInt8] = []
    buf += float32Bytes(26.5)
    buf += int32Bytes(1500)
    buf += uint32Bytes(0x4040_0000)
    buf += int16Bytes(325)
    buf += int32Bytes(-42)
    buf += int32Bytes(Int32(bitPattern: 0x8000_0001))
    buf += int16Bytes(-100)
    buf += int16Bytes(Int16(bitPattern: 60000))
    buf += [UInt8(bitPattern: -5)]
    buf += [200]
    buf += [1]
    buf += [0]
    return buf
  }

  private func assertInvalid(_ schema: RefloatConfigSchema, _ raw: [UInt8], _ fields: [String: Any], file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertThrowsError(try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: fields), "\(fields)", file: file, line: line) { error in
      XCTAssertEqual((error as? RefloatConfigEncodeException)?.code, .CONFIG_VALUE_INVALID, file: file, line: line)
    }
  }

  private func decodeAllFields(_ schema: RefloatConfigSchema, _ raw: [UInt8]) -> [String: Any] {
    let fields = RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: raw)
    XCTAssertEqual(Set(schema.fields.map(\.id)), Set(fields.keys), "Every schema field must decode")
    return fields
  }

  private func float32Bytes(_ v: Float) -> [UInt8] { uint32Bytes(v.bitPattern) }
  private func int32Bytes(_ v: Int32) -> [UInt8] { uint32Bytes(UInt32(bitPattern: v)) }
  private func uint32Bytes(_ v: UInt32) -> [UInt8] {
    [UInt8((v >> 24) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 8) & 0xff), UInt8(v & 0xff)]
  }
  private func int16Bytes(_ v: Int16) -> [UInt8] {
    let u = UInt16(bitPattern: v)
    return [UInt8((u >> 8) & 0xff), UInt8(u & 0xff)]
  }
  private func readUInt32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
    (UInt32(bytes[offset]) << 24) | (UInt32(bytes[offset + 1]) << 16)
      | (UInt32(bytes[offset + 2]) << 8) | UInt32(bytes[offset + 3])
  }
}
