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

  func testFractionalValuesRejectedForIntegerFieldsWhileScaledFloatsRoundHalfUp() throws {
    let schema = allTypeSchema()
    let raw = buildRawConfig(schema)
    for fieldId in ["u8", "i8", "u16", "i16", "u32", "i32"] {
      assertInvalid(schema, raw, [fieldId: 7.5])
      assertInvalid(schema, raw, [fieldId: 2.7])
    }
    let scaled = try RefloatConfigEncoder.encode(schema: schema, rawConfig: raw, fields: ["f16_scaled": 1.235, "f32_scaled": -2.5005])
    let decoded = decodeAllFields(schema, scaled)
    XCTAssertEqual(decoded["f16_scaled"] as? Double ?? 0, 1.24, accuracy: 1e-9)
    XCTAssertEqual(decoded["f32_scaled"] as? Double ?? 0, -2.5, accuracy: 1e-9)
  }

  func testOverlappingFieldsAreRejectedWhileAdjacentFieldsSucceed() throws {
    let overlapping = RefloatConfigSchema(
      hash: "overlap",
      fields: [
        field("a", .uint16, offset: 0),
        field("b", .uint16, offset: 1),
      ]
    )
    XCTAssertThrowsError(
      try RefloatConfigEncoder.encodeChangeset(schema: overlapping, rawConfig: [0, 0, 0, 0], changes: ["a": 10.0, "b": 20.0])
    ) { error in
      XCTAssertEqual((error as? RefloatConfigEncodeException)?.code, .CONFIG_ENCODE_FAILED)
    }

    let adjacent = RefloatConfigSchema(
      hash: "adjacent",
      fields: [
        field("a", .uint16, offset: 0),
        field("b", .uint16, offset: 2),
      ]
    )
    let encoded = try RefloatConfigEncoder.encodeChangeset(
      schema: adjacent,
      rawConfig: [0, 0, 0, 0],
      changes: ["a": Double(0x1234), "b": Double(0x5678)]
    )
    XCTAssertEqual(encoded.rawConfig, [0x12, 0x34, 0x56, 0x78])
    XCTAssertEqual(encoded.changedFieldIds, ["a", "b"])
  }

  func testOffGridSchemaMaxRoundTripsWithoutFalseRangeRejection() throws {
    let schema = RefloatConfigSchema(
      hash: "offgrid",
      fields: [
        RefloatConfigSchemaField(id: "v", type: .float16Scaled, label: "v", unit: nil, min: 0.0, max: 0.3505, offset: 0, scale: 1000.0),
      ]
    )
    let encoded = try RefloatConfigEncoder.encodeChangeset(schema: schema, rawConfig: [0, 0], changes: ["v": 0.3505])
    XCTAssertEqual(encoded.changedFieldIds, ["v"])
    XCTAssertEqual(encoded.rawConfig, [0x01, 0x5F])
    assertInvalid(schema, [0, 0], ["v": 0.3506])
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
    for rawInt in [Int32(0), 1, -1, 1500, -2500, 16_777_216, Int32.min] {
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

  func testRejectsInternalSchemaAndMetaFieldsUnlessExplicitlyAllowed() throws {
    let schema = RefloatConfigSchema(
      hash: "internal-test",
      fields: [
        RefloatConfigSchemaField(id: "kp", type: .float32, label: "Angle P", unit: nil, min: 0, max: 100, offset: 0),
        RefloatConfigSchemaField(id: "meta.is_default", type: .bool, label: "Is Default", unit: nil, min: nil, max: nil, offset: 4),
        RefloatConfigSchemaField(id: "group_internal", type: .uint8, label: "Group Internal", unit: nil, min: 0, max: 255, offset: 5),
        RefloatConfigSchemaField(id: "subgroup_meta", type: .uint8, label: "Subgroup Meta", unit: nil, min: 0, max: 255, offset: 6),
        RefloatConfigSchemaField(id: "overlay_internal", type: .uint8, label: "Overlay Internal", unit: nil, min: 0, max: 255, offset: 7),
      ],
      groups: [
        RefloatConfigSchemaGroup(
          name: "Internal",
          subgroups: [
            RefloatConfigSchemaSubgroup(name: "Flags", items: [.field("group_internal")]),
          ]
        ),
        RefloatConfigSchemaGroup(
          name: "General",
          subgroups: [
            RefloatConfigSchemaSubgroup(name: "Meta", items: [.field("subgroup_meta")]),
          ]
        ),
      ]
    )
    let overlay = RefloatFieldOverlay(entries: [
      "overlay_internal": RefloatFieldOverlayEntry(risk: .internal),
    ])
    let raw = [UInt8](repeating: 0, count: 8)

    for change: [String: Any] in [
      ["meta.is_default": false],
      ["group_internal": 1.0],
      ["subgroup_meta": 2.0],
      ["overlay_internal": 3.0],
    ] {
      XCTAssertThrowsError(
        try RefloatConfigEncoder.encodeChangeset(schema: schema, rawConfig: raw, changes: change, overlay: overlay)
      ) { error in
        XCTAssertEqual((error as? RefloatConfigEncodeException)?.code, .CONFIG_VALUE_INVALID)
      }
    }

    let allowed = try RefloatConfigEncoder.encodeChangeset(
      schema: schema,
      rawConfig: raw,
      changes: ["meta.is_default": true, "group_internal": 1.0, "subgroup_meta": 2.0],
      overlay: overlay,
      allowInternal: true
    )
    XCTAssertEqual(allowed.changedFieldIds, ["meta.is_default", "group_internal", "subgroup_meta"])
  }

  func testRejectsScaledValuesThatTruncateUnderFirmwareFloat32RoundTrip() throws {
    let schema = RefloatConfigSchema(
      hash: "adc-float32",
      fields: [
        RefloatConfigSchemaField(id: "fault_adc1", type: .float16Scaled, label: "ADC1", unit: nil, min: 0, max: 5, offset: 0, scale: 1000.0),
        RefloatConfigSchemaField(id: "scaled32", type: .float32Scaled, label: "Scaled32", unit: nil, min: -5, max: 5, offset: 2, scale: 1000.0),
      ]
    )
    let raw = [UInt8](repeating: 0, count: 6)

    assertInvalid(schema, raw, ["fault_adc1": 0.251])
    assertInvalid(schema, raw, ["scaled32": 0.251])
    assertInvalid(schema, raw, ["scaled32": -0.251])

    let stable = try RefloatConfigEncoder.encodeChangeset(
      schema: schema,
      rawConfig: raw,
      changes: ["fault_adc1": 0.250, "scaled32": 0.252]
    )
    XCTAssertEqual(stable.changedFieldIds, ["fault_adc1", "scaled32"])
  }

  func testFloat32AutoIndependentByteVectors() throws {
    let schema = RefloatConfigSchema(hash: "t", fields: [field("v", .float32Auto, offset: 0)])
    let vectors: [(Double, [UInt8])] = [
      (0.0, [0x00, 0x00, 0x00, 0x00]),
      (1e-40, [0x00, 0x00, 0x00, 0x00]),
      (0.25, [0x3E, 0x80, 0x00, 0x00]),
      (0.5, [0x3F, 0x00, 0x00, 0x00]),
      (1.0, [0x3F, 0x80, 0x00, 0x00]),
      (-1.0, [0xBF, 0x80, 0x00, 0x00]),
      (3.0, [0x40, 0x40, 0x00, 0x00]),
      (-2.5, [0xC0, 0x20, 0x00, 0x00]),
      (30.0, [0x41, 0xF0, 0x00, 0x00]),
      (100.0, [0x42, 0xC8, 0x00, 0x00]),
    ]
    for (value, expected) in vectors {
      let encoded = try RefloatConfigEncoder.encode(schema: schema, rawConfig: [0, 0, 0, 0], fields: ["v": value])
      XCTAssertEqual(expected, encoded, "FLOAT32_AUTO vector for \(value)")
    }
  }

  func testFloat16ScaledIndependentEdgeByteVectors() throws {
    let scale100 = RefloatConfigSchema(hash: "t", fields: [field("v", .float16Scaled, offset: 0, scale: 100.0)])
    let scale100Vectors: [(Double, [UInt8])] = [
      (0.0, [0x00, 0x00]),
      (1.23, [0x00, 0x7B]),
      (-0.01, [0xFF, 0xFF]),
      (327.67, [0x7F, 0xFF]),
      (-327.68, [0x80, 0x00]),
    ]
    for (value, expected) in scale100Vectors {
      let encoded = try RefloatConfigEncoder.encode(schema: scale100, rawConfig: [0, 0], fields: ["v": value])
      XCTAssertEqual(expected, encoded, "FLOAT16_SCALED(100) vector for \(value)")
    }

    let kiSchema = RefloatConfigSchema(hash: "t", fields: [
      RefloatConfigSchemaField(id: "ki", type: .float16Scaled, label: "ki", unit: nil, min: 0.0, max: 0.5, offset: 0, scale: 100_000.0),
    ])
    let kiVectors: [(Double, [UInt8])] = [
      (0.0, [0x00, 0x00]),
      (0.001, [0x00, 0x64]),
      (0.32767, [0x7F, 0xFF]),
    ]
    for (value, expected) in kiVectors {
      let encoded = try RefloatConfigEncoder.encode(schema: kiSchema, rawConfig: [0, 0], fields: ["ki": value])
      XCTAssertEqual(expected, encoded, "FLOAT16_SCALED(100000) vector for \(value)")
    }
  }

  func testEffectiveRangeRejectsSchemaAndWireOverflows() throws {
    let schema = RefloatConfigSchema(
      hash: "refloat-edges",
      fields: [
        RefloatConfigSchemaField(id: "ki", type: .float16Scaled, label: "Angle I", unit: nil, min: 0.0, max: 0.5, offset: 0, scale: 100_000.0),
        RefloatConfigSchemaField(id: "turntilt_start_erpm", type: .uint16, label: "ERPM Threshold", unit: nil, min: 100.0, max: 100_000.0, offset: 2, scale: nil),
        RefloatConfigSchemaField(id: "turntilt_yaw_aggregate", type: .uint8, label: "Turn Aggregate Target", unit: nil, min: 50.0, max: 360.0, offset: 4, scale: nil),
        RefloatConfigSchemaField(
          id: "inputtilt_remote_type",
          type: .uint8,
          label: "Remote Type",
          unit: nil,
          min: nil,
          max: nil,
          offset: 5,
          scale: nil,
          xmlType: 4,
          enumNames: ["None", "UART", "PPM"]
        ),
      ]
    )
    let raw: [UInt8] = [0, 0, 0, 0, 0, 0]

    assertInvalid(schema, raw, ["ki": 0.35])
    assertInvalid(schema, raw, ["ki": -0.001])
    assertInvalid(schema, raw, ["turntilt_start_erpm": 100_000.0])
    assertInvalid(schema, raw, ["turntilt_start_erpm": 99.0])
    assertInvalid(schema, raw, ["turntilt_yaw_aggregate": 360.0])
    assertInvalid(schema, raw, ["turntilt_yaw_aggregate": 49.0])
    assertInvalid(schema, raw, ["inputtilt_remote_type": -1.0])
    assertInvalid(schema, raw, ["inputtilt_remote_type": 3.0])
    assertInvalid(schema, raw, ["inputtilt_remote_type": 1.5])
    assertInvalid(schema, raw, ["ki": NSNull()])

    let valid = try RefloatConfigEncoder.encodeChangeset(
      schema: schema,
      rawConfig: raw,
      changes: [
        "ki": 0.32767,
        "turntilt_start_erpm": 65_535.0,
        "turntilt_yaw_aggregate": 255.0,
        "inputtilt_remote_type": 2.0,
      ]
    )
    XCTAssertEqual(valid.changedFieldIds, ["ki", "turntilt_start_erpm", "turntilt_yaw_aggregate", "inputtilt_remote_type"])
  }

  func testEncodeChangesetDropsWirePrecisionNoOps() throws {
    let schema = RefloatConfigSchema(
      hash: "noop",
      fields: [
        RefloatConfigSchemaField(id: "kp", type: .float16Scaled, label: "kp", unit: nil, min: 0.0, max: 50.0, offset: 0, scale: 10.0),
        RefloatConfigSchemaField(id: "ki", type: .float16Scaled, label: "ki", unit: nil, min: 0.0, max: 0.5, offset: 2, scale: 100_000.0),
      ]
    )
    let raw: [UInt8] = [0x00, 0xC8, 0x00, 0x64]

    let noOp = try RefloatConfigEncoder.encodeChangeset(schema: schema, rawConfig: raw, changes: ["kp": 20.04, "ki": 0.001])
    XCTAssertTrue(noOp.changedFieldIds.isEmpty)
    XCTAssertEqual(raw, noOp.rawConfig)

    let partial = try RefloatConfigEncoder.encodeChangeset(schema: schema, rawConfig: raw, changes: ["kp": 20.0, "ki": 0.002])
    XCTAssertEqual(partial.changedFieldIds, ["ki"])
    XCTAssertEqual(Array(raw[0..<2]), Array(partial.rawConfig[0..<2]))
    XCTAssertEqual([0x00, 0xC8], Array(partial.rawConfig[2..<4]))
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
