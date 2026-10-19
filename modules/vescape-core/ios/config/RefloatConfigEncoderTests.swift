import XCTest
@testable import VescapeCore

/// Ported from Android `RefloatConfigEncoderTest.kt` to keep encode byte-for-byte aligned.
final class RefloatConfigEncoderTests: XCTestCase {
  func testDraftHalfStepRoundsUpWithTheSchemaMultiplier() throws {
    let schema = RefloatConfigSchema(hash: "scaled", fields: [RefloatConfigSchemaField(id: "kp", type: .float16Scaled, label: "kp", unit: nil, min: 0, max: 40, offset: 0, scale: 10)])
    let result = try RefloatConfigEncoder.encode(schema: schema, rawConfig: [0, 0, 77, 88], fields: ["kp": 15.45], strict: true)
    XCTAssertEqual(result, [0, 155, 77, 88])
  }

  func testDraftEncodingRejectsMissingNonFiniteAndOutOfBoundsFields() throws {
    let schema = RefloatConfigSchema(hash: "draft", fields: [RefloatConfigSchemaField(id: "kp", type: .float32, label: "kp", unit: nil, min: 0, max: 50, offset: 0)])
    let invalid: [[String: Any]] = [["missing": 1.0], ["kp2": 1.0], ["kp": true], ["kp": Double.nan], ["kp": Double.infinity], ["kp": 51.0]]
    for fields in invalid {
      XCTAssertThrowsError(try RefloatConfigEncoder.encode(schema: schema, rawConfig: Array(repeating: 0, count: 8), fields: fields, strict: true))
    }
    let raw: [UInt8] = [0, 0, 0, 0, 1, 2, 3, 4]
    let result = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: ["kp": 22.5], strict: true)
    XCTAssertEqual(Array(result[4..<8]), Array(raw[4..<8]))
    XCTAssertEqual(Array(result[0..<4]), [0x41, 0xB4, 0, 0])
  }


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

  func testUnknownFieldsInMapAreSkipped() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    let result = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: ["nonexistent_field": 42.0])
    XCTAssertEqual(raw, result, "Unknown fields should not change anything")
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
    for value in [0.0, 1.0, -1.0, 0.5, 100.0, -500.0, 12345.678, 0.001] {
      var raw: [UInt8] = [0, 0, 0, 0]
      writeFloat32AutoHelper(&raw, 0, value)
      let decoded = decodeAllFields(schema, raw)
      let reEncoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: decoded)
      XCTAssertEqual(raw, reEncoded, "FLOAT32_AUTO round-trip for \(value)")
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

  // MARK: - Helpers

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
    buf += float32Bytes(26.5)                       // f32
    buf += int32Bytes(1500)                         // f32_scaled: 1.5
    buf += [0, 0, 0, 0]                             // f32_auto placeholder
    buf += int16Bytes(325)                          // f16_scaled: 3.25
    buf += int32Bytes(-42)                          // i32
    buf += int32Bytes(Int32(bitPattern: 0x8000_0001)) // u32
    buf += int16Bytes(-100)                         // i16
    buf += int16Bytes(Int16(bitPattern: 60000))     // u16
    buf += [UInt8(bitPattern: -5)]                   // i8
    buf += [200]                                     // u8
    buf += [1]                                       // bool_true
    buf += [0]                                       // bool_false
    return buf
  }

  private func decodeAllFields(_ schema: RefloatConfigSchema, _ raw: [UInt8]) -> [String: Any] {
    guard let snapshot = try? RefloatConfigDecoder.decode(
      schema: schema, rawConfig: raw, boardId: nil, canId: 0, capturedAt: 0, fwVersion: nil
    ) else { return [:] }
    var fields: [String: Any] = [:]
    for group in snapshot.groups {
      for f in group.fields { fields[f.id] = f.value }
    }
    return fields
  }

  private func writeFloat32AutoHelper(_ bytes: inout [UInt8], _ offset: Int, _ value: Double) {
    if value == 0.0 {
      putUInt32(&bytes, offset, 0)
      return
    }
    let neg = value < 0.0
    let absVal = abs(value)
    let e = Int((log(absVal) / log(2.0)).rounded(.down)) + 126
    let eRaw = min(max(e, 0), 255)
    let sig = absVal / pow(2.0, Double(eRaw - 126)) - 0.5
    let sigI = min(max(Int((sig * 8_388_608.0 * 2.0).rounded(.towardZero)), 0), 0x7fffff)
    var raw = (UInt32(eRaw) << 23) | UInt32(sigI)
    if neg { raw |= (UInt32(1) << 31) }
    putUInt32(&bytes, offset, raw)
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
  private func putUInt32(_ bytes: inout [UInt8], _ offset: Int, _ v: UInt32) {
    bytes[offset] = UInt8((v >> 24) & 0xff)
    bytes[offset + 1] = UInt8((v >> 16) & 0xff)
    bytes[offset + 2] = UInt8((v >> 8) & 0xff)
    bytes[offset + 3] = UInt8(v & 0xff)
  }
  private func readUInt32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
    (UInt32(bytes[offset]) << 24) | (UInt32(bytes[offset + 1]) << 16)
      | (UInt32(bytes[offset + 2]) << 8) | UInt32(bytes[offset + 3])
  }
}
