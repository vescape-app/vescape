import XCTest
@testable import VescapeCore

final class BoardConfigXmlCodecTests: XCTestCase {
  private func repoRoot() -> URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private func parseFixture(_ version: String) throws -> RefloatConfigSchema {
    let data = try Data(
      contentsOf: repoRoot().appendingPathComponent("shared/fixtures/refloat-schema/settings-\(version).xml.zlib")
    )
    return try RefloatConfigSchemaParser.parse([UInt8](data))
  }

  private func readVescToolExportFixture() throws -> String {
    try String(
      contentsOf: repoRoot().appendingPathComponent("shared/fixtures/refloat-schema/vesc-tool-export-1.3.0.xml"),
      encoding: .utf8
    )
  }

  private func buildDefaultConfigBytes(
    _ schema: RefloatConfigSchema,
    overlay: RefloatFieldOverlay = .empty
  ) -> [UInt8] {
    let totalSize = schema.fields.map { $0.offset + $0.type.byteSize }.max() ?? 0
    var raw = [UInt8](repeating: 0, count: totalSize)
    for field in schema.fields {
      guard let defaultValue = field.defaultValue?.toBridgeValue() else { continue }
      // intentional-suppression: fixture defaults outside strict bounds remain zero-filled
      guard let encoded = try? RefloatConfigEncoder.encodeFieldBytes(field, defaultValue, overlay: overlay) else {
        continue
      }
      for i in 0..<encoded.count {
        raw[field.offset + i] = encoded[i]
      }
    }
    return raw
  }

  func testExportThenReimportProducesEmptyChangeset() throws {
    let schema = try parseFixture("1.3.0")
    let baseRaw = buildDefaultConfigBytes(schema)
    let modifiedRaw = try RefloatConfigEncoder.encode(
      schema: schema,
      rawConfig: baseRaw,
      fields: [
        "kp": 32.5,
        "atr_strength_up": 2.2,
        "turntilt_strength": 3.5,
        "leds.on": false,
        "leds.front.mode": 2.0,
      ]
    )

    let xml = BoardConfigXmlCodec.exportXml(schema: schema, rawConfig: modifiedRaw)
    XCTAssertTrue(xml.contains("<CustomConfiguration>"))
    XCTAssertTrue(xml.contains("<ConfigVersion>4</ConfigVersion>"))
    XCTAssertTrue(xml.contains("<leds.on>0</leds.on>"))
    XCTAssertTrue(xml.contains("<leds.front.mode>2</leds.front.mode>"))
    XCTAssertTrue(xml.contains("</CustomConfiguration>"))

    let plan = try BoardConfigXmlCodec.planImport(
      boardId: "board-1",
      currentSchema: schema,
      currentRawConfig: modifiedRaw,
      xml: xml
    )

    XCTAssertEqual(plan.configVersion, 4)
    XCTAssertEqual(plan.currentSchemaHash, schema.hash)
    XCTAssertTrue(plan.changes.isEmpty, "Expected empty changeset on re-import, got \(plan.changes)")
    XCTAssertTrue(plan.skippedFields.isEmpty, "Expected no skipped fields on re-import, got \(plan.skippedFields)")
  }

  func testRealisticVescToolExportFixtureImportsOnlyChangedFields() throws {
    let schema = try parseFixture("1.3.0")
    let defaultRaw = buildDefaultConfigBytes(schema)
    let fixtureXml = try readVescToolExportFixture()

    let plan = try BoardConfigXmlCodec.planImport(
      boardId: "board-1",
      currentSchema: schema,
      currentRawConfig: defaultRaw,
      xml: fixtureXml
    )

    XCTAssertEqual(plan.configVersion, 4)
    XCTAssertEqual(
      Set(plan.changes.keys),
      ["kp", "atr_strength_up", "turntilt_strength", "leds.on", "leds.front.mode"]
    )
    XCTAssertEqual(plan.changes["kp"] as? Double ?? 0, 31.5, accuracy: 1e-6)
    XCTAssertEqual(plan.changes["atr_strength_up"] as? Double ?? 0, 2.1, accuracy: 1e-6)
    XCTAssertEqual(plan.changes["turntilt_strength"] as? Double ?? 0, 3.25, accuracy: 1e-6)
    XCTAssertEqual(plan.changes["leds.on"] as? Bool, false)
    XCTAssertEqual(plan.changes["leds.front.mode"] as? Double ?? 0, 2.0, accuracy: 1e-6)
    XCTAssertNil(plan.changes["meta.is_default"])
    XCTAssertTrue(plan.skippedFields.isEmpty)

    let applied = try RefloatConfigEncoder.encodeChangeset(
      schema: schema,
      rawConfig: defaultRaw,
      changes: plan.changes
    ).rawConfig
    let secondPass = try BoardConfigXmlCodec.planImport(
      boardId: "board-1",
      currentSchema: schema,
      currentRawConfig: applied,
      xml: fixtureXml
    )
    XCTAssertTrue(secondPass.changes.isEmpty)
    XCTAssertTrue(secondPass.skippedFields.isEmpty)
  }

  func testCrossVersionImportListsUnknownIdsInSkippedFields() throws {
    let schema121 = try parseFixture("1.2.1")
    let schema130 = try parseFixture("1.3.0")

    let raw121 = try RefloatConfigEncoder.encode(
      schema: schema121,
      rawConfig: buildDefaultConfigBytes(schema121),
      fields: ["kp": 28.0, "atr_strength_up": 1.8]
    )
    let raw130 = try RefloatConfigEncoder.encode(
      schema: schema130,
      rawConfig: buildDefaultConfigBytes(schema130),
      fields: ["kp": 22.0, "atr_strength_up": 0.9]
    )

    let xml121 = BoardConfigXmlCodec.exportXml(schema: schema121, rawConfig: raw121)
    let plan121To130 = try BoardConfigXmlCodec.planImport(
      boardId: "board-1",
      currentSchema: schema130,
      currentRawConfig: raw130,
      xml: xml121
    )

    XCTAssertEqual(plan121To130.changes["kp"] as? Double ?? 0, 28.0, accuracy: 1e-6)
    XCTAssertEqual(plan121To130.changes["atr_strength_up"] as? Double ?? 0, 1.8, accuracy: 1e-6)

    let ids130 = Set(schema130.fields.map(\.id))
    let removedFrom121 = schema121.fields
      .filter { !ids130.contains($0.id) && !$0.id.hasPrefix("meta.") && !RefloatFieldOverlay.shared.isInternal($0.id) }
      .map(\.id)
    XCTAssertFalse(removedFrom121.isEmpty)
    let skipped121To130 = Dictionary(uniqueKeysWithValues: plan121To130.skippedFields.map { ($0.fieldId, $0) })
    for id in removedFrom121 {
      XCTAssertEqual(skipped121To130[id]?.reason, "Not in current firmware schema")
    }

    let xml130 = BoardConfigXmlCodec.exportXml(schema: schema130, rawConfig: raw130)
    let plan130To121 = try BoardConfigXmlCodec.planImport(
      boardId: "board-1",
      currentSchema: schema121,
      currentRawConfig: raw121,
      xml: xml130
    )
    let ids121 = Set(schema121.fields.map(\.id))
    let addedIn130 = schema130.fields
      .filter { !ids121.contains($0.id) && !$0.id.hasPrefix("meta.") && !RefloatFieldOverlay.shared.isInternal($0.id) }
      .map(\.id)
    XCTAssertFalse(addedIn130.isEmpty)
    let skipped130To121 = Dictionary(uniqueKeysWithValues: plan130To121.skippedFields.map { ($0.fieldId, $0) })
    for id in addedIn130 {
      XCTAssertEqual(skipped130To121[id]?.reason, "Not in current firmware schema")
    }
  }

  func testIgnoresInternalFieldsAndSkipsInvalidValues() throws {
    let schema = RefloatConfigSchema(
      hash: "test-hash",
      fields: [
        RefloatConfigSchemaField(id: "kp", type: .float32, label: "Angle P", unit: nil, min: 0, max: 100, offset: 0),
        RefloatConfigSchemaField(id: "limit_field", type: .uint8, label: "Limit", unit: nil, min: 0, max: 50, offset: 4),
        RefloatConfigSchemaField(id: "flag_field", type: .bool, label: "Flag", unit: nil, min: nil, max: nil, offset: 5),
        RefloatConfigSchemaField(id: "meta.is_default", type: .bool, label: "Is Default", unit: nil, min: nil, max: nil, offset: 6),
        RefloatConfigSchemaField(id: "group_internal", type: .uint8, label: "Group Internal", unit: nil, min: 0, max: 255, offset: 7),
        RefloatConfigSchemaField(id: "overlay_internal", type: .uint8, label: "Overlay Internal", unit: nil, min: 0, max: 255, offset: 8),
        RefloatConfigSchemaField(id: "hard_limited", type: .uint8, label: "Hard Limited", unit: nil, min: 0, max: 200, offset: 9),
      ],
      groups: [
        RefloatConfigSchemaGroup(
          name: "Internal",
          subgroups: [
            RefloatConfigSchemaSubgroup(name: "Flags", items: [.field("group_internal")]),
          ]
        ),
      ]
    )
    let overlay = RefloatFieldOverlay(entries: [
      "overlay_internal": RefloatFieldOverlayEntry(risk: .internal),
      "hard_limited": RefloatFieldOverlayEntry(hardMax: 40),
    ])

    let currentRaw = try RefloatConfigEncoder.encode(
      schema: schema,
      rawConfig: [UInt8](repeating: 0, count: 10),
      fields: ["kp": 20.0, "limit_field": 10.0, "flag_field": false, "hard_limited": 20.0],
      overlay: overlay
    )

    let xml = """
    <?xml version="1.0" encoding="UTF-8"?>
    <CustomConfiguration>
        <ConfigVersion>4</ConfigVersion>
        <kp>25.5</kp>
        <limit_field>120</limit_field>
        <flag_field>not-a-bool</flag_field>
        <hard_limited>80</hard_limited>
        <meta.is_default>1</meta.is_default>
        <group_internal>42</group_internal>
        <overlay_internal>77</overlay_internal>
        <unknown_param>123</unknown_param>
    </CustomConfiguration>
    """

    let plan = try BoardConfigXmlCodec.planImport(
      boardId: "board-1",
      currentSchema: schema,
      currentRawConfig: currentRaw,
      xml: xml,
      overlay: overlay
    )

    XCTAssertEqual(Set(plan.changes.keys), ["kp"])
    XCTAssertEqual(plan.changes["kp"] as? Double ?? 0, 25.5, accuracy: 1e-6)
    XCTAssertEqual(
      plan.skippedFields.map(\.fieldId),
      ["limit_field", "flag_field", "hard_limited", "unknown_param"]
    )
    XCTAssertNil(plan.changes["meta.is_default"])
    XCTAssertNil(plan.changes["group_internal"])
    XCTAssertNil(plan.changes["overlay_internal"])
    let internalIds: Set<String> = ["meta.is_default", "group_internal", "overlay_internal"]
    XCTAssertFalse(plan.skippedFields.contains { internalIds.contains($0.fieldId) })
  }

  func testRejectsMalformedWrongRootAndDoctypeXmlWithTypedError() throws {
    let schema = try parseFixture("1.3.0")
    let raw = buildDefaultConfigBytes(schema)

    func assertInvalidXml(_ xml: String) {
      XCTAssertThrowsError(
        try BoardConfigXmlCodec.planImport(
          boardId: "board-1",
          currentSchema: schema,
          currentRawConfig: raw,
          xml: xml
        )
      ) { error in
        let coded = error as? RefloatConfigEncodeException
        XCTAssertEqual(coded?.code, .INVALID_CONFIG_XML)
      }
    }

    assertInvalidXml("<CustomConfiguration><kp>20")
    assertInvalidXml("   ")
    assertInvalidXml("<MCConfiguration><kp>20</kp></MCConfiguration>")
    assertInvalidXml("<!DOCTYPE foo><CustomConfiguration><kp>20</kp></CustomConfiguration>")
  }
}
