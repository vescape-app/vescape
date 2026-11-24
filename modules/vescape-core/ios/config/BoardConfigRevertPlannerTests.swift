import GRDB
import XCTest
@testable import VescapeCore

final class BoardConfigRevertPlannerTests: XCTestCase {
  private func parseFixture(_ version: String) throws -> RefloatConfigSchema {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let data = try Data(
      contentsOf: root.appendingPathComponent("shared/fixtures/refloat-schema/settings-\(version).xml.zlib")
    )
    return try RefloatConfigSchemaParser.parse([UInt8](data))
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

  func testSameSchemaRevertRestoresExactBytesExceptInternalFields() throws {
    let schema = try parseFixture("1.3.0")
    let targetRaw = buildDefaultConfigBytes(schema)

    let editableChanges: [String: Any] = [
      "kp": 32.0,
      "atr_strength_up": 2.2,
      "turntilt_strength": 3.5,
      "leds.on": false,
    ]
    var currentRaw = try RefloatConfigEncoder.encode(schema: schema, rawConfig: targetRaw, fields: editableChanges)

    let internalField = try XCTUnwrap(schema.fields.first { $0.id.hasPrefix("meta.") })
    let originalInternalBytes = Array(currentRaw[internalField.offset..<(internalField.offset + internalField.type.byteSize)])
    currentRaw[internalField.offset] ^= 0x01
    let mutatedInternalBytes = Array(currentRaw[internalField.offset..<(internalField.offset + internalField.type.byteSize)])
    XCTAssertNotEqual(originalInternalBytes, mutatedInternalBytes)

    let plan = BoardConfigRevertPlanner.plan(
      boardId: "board-1",
      currentSchema: schema,
      currentRawConfig: currentRaw,
      targetRevisionId: 42,
      targetCreatedAtMs: 1_700_000_000_000,
      targetRefloatVersion: "1.3.0",
      targetSchema: schema,
      targetRawConfig: targetRaw
    )

    XCTAssertTrue(plan.sameSchema)
    XCTAssertEqual(plan.targetRevisionId, 42)
    XCTAssertTrue(plan.skippedFields.isEmpty)
    XCTAssertEqual(Set(plan.changes.keys), Set(editableChanges.keys))
    XCTAssertNil(plan.changes[internalField.id])

    let applied = try RefloatConfigEncoder.encodeChangeset(
      schema: schema,
      rawConfig: currentRaw,
      changes: plan.changes
    ).rawConfig

    for field in schema.fields {
      let range = field.offset..<(field.offset + field.type.byteSize)
      if field.id == internalField.id {
        XCTAssertEqual(Array(applied[range]), mutatedInternalBytes, "Internal field must not change on revert")
      } else {
        XCTAssertEqual(Array(applied[range]), Array(targetRaw[range]), "Field \(field.id) must match target bytes")
      }
    }
  }

  func testCrossSchemaRevertRestoresMatchingIdsAndSkipsUnrestorableFields() throws {
    let schema121 = try parseFixture("1.2.1")
    let schema130 = try parseFixture("1.3.0")

    let targetRaw121 = try RefloatConfigEncoder.encode(
      schema: schema121,
      rawConfig: buildDefaultConfigBytes(schema121),
      fields: ["kp": 28.0, "atr_strength_up": 1.8]
    )
    let currentRaw130 = try RefloatConfigEncoder.encode(
      schema: schema130,
      rawConfig: buildDefaultConfigBytes(schema130),
      fields: ["kp": 22.0, "atr_strength_up": 0.9]
    )

    let plan = BoardConfigRevertPlanner.plan(
      boardId: "board-1",
      currentSchema: schema130,
      currentRawConfig: currentRaw130,
      targetRevisionId: 7,
      targetCreatedAtMs: 1_700_000_000_000,
      targetRefloatVersion: "1.2.1",
      targetSchema: schema121,
      targetRawConfig: targetRaw121
    )

    XCTAssertFalse(plan.sameSchema)
    XCTAssertEqual(plan.changes["kp"] as? Double ?? 0, 28.0, accuracy: 1e-6)
    XCTAssertEqual(plan.changes["atr_strength_up"] as? Double ?? 0, 1.8, accuracy: 1e-6)

    let ids130 = Set(schema130.fields.map(\.id))
    let removedNonInternal121 = schema121.fields
      .filter { !ids130.contains($0.id) && !$0.id.hasPrefix("meta.") && !RefloatFieldOverlay.shared.isInternal($0.id) }
      .map(\.id)
    XCTAssertFalse(removedNonInternal121.isEmpty)

    let skippedById = Dictionary(uniqueKeysWithValues: plan.skippedFields.map { ($0.fieldId, $0) })
    for missingId in removedNonInternal121 {
      XCTAssertEqual(skippedById[missingId]?.reason, "Not in current firmware schema")
    }

    let applied = try RefloatConfigEncoder.encodeChangeset(
      schema: schema130,
      rawConfig: currentRaw130,
      changes: plan.changes
    ).rawConfig
    let decodedAfter = RefloatConfigFieldDecoder.decodeFieldMap(schema: schema130, rawConfig: applied)
    XCTAssertEqual(decodedAfter["kp"] as? Double ?? 0, 28.0, accuracy: 1e-6)
    XCTAssertEqual(decodedAfter["atr_strength_up"] as? Double ?? 0, 1.8, accuracy: 1e-6)
  }

  func testExcludesInternalFieldsAndSkipsValuesFailingValidation() throws {
    let targetSchema = RefloatConfigSchema(
      hash: "target-hash",
      fields: [
        RefloatConfigSchemaField(id: "kp", type: .float32, label: "Angle P", unit: nil, min: 0, max: 100, offset: 0),
        RefloatConfigSchemaField(id: "limit_field", type: .uint8, label: "Limit", unit: nil, min: 0, max: 200, offset: 4),
        RefloatConfigSchemaField(id: "meta.is_default", type: .bool, label: "Is Default", unit: nil, min: nil, max: nil, offset: 5),
        RefloatConfigSchemaField(id: "group_internal", type: .uint8, label: "Internal", unit: nil, min: 0, max: 255, offset: 6),
        RefloatConfigSchemaField(id: "overlay_internal", type: .uint8, label: "Overlay Internal", unit: nil, min: 0, max: 255, offset: 7),
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
    let currentSchema = RefloatConfigSchema(
      hash: "current-hash",
      fields: [
        RefloatConfigSchemaField(id: "kp", type: .float32, label: "Angle P", unit: nil, min: 0, max: 100, offset: 0),
        RefloatConfigSchemaField(id: "limit_field", type: .uint8, label: "Limit", unit: nil, min: 0, max: 50, offset: 4),
        RefloatConfigSchemaField(id: "meta.is_default", type: .bool, label: "Is Default", unit: nil, min: nil, max: nil, offset: 5),
        RefloatConfigSchemaField(id: "group_internal", type: .uint8, label: "Internal", unit: nil, min: 0, max: 255, offset: 6),
        RefloatConfigSchemaField(id: "overlay_internal", type: .uint8, label: "Overlay Internal", unit: nil, min: 0, max: 255, offset: 7),
      ],
      groups: targetSchema.groups
    )
    let overlay = RefloatFieldOverlay(entries: [
      "overlay_internal": RefloatFieldOverlayEntry(risk: .internal),
    ])

    var targetRaw = try RefloatConfigEncoder.encode(
      schema: targetSchema,
      rawConfig: [UInt8](repeating: 0, count: 8),
      fields: ["kp": 25.0, "limit_field": 120.0, "group_internal": 9.0],
      overlay: .empty,
      allowInternal: true
    )
    targetRaw[5] = 1
    targetRaw[7] = 77

    var currentRaw = try RefloatConfigEncoder.encode(
      schema: currentSchema,
      rawConfig: [UInt8](repeating: 0, count: 8),
      fields: ["kp": 20.0, "limit_field": 30.0, "group_internal": 1.0],
      overlay: .empty,
      allowInternal: true
    )
    currentRaw[5] = 0
    currentRaw[7] = 11

    let plan = BoardConfigRevertPlanner.plan(
      boardId: "board-1",
      currentSchema: currentSchema,
      currentRawConfig: currentRaw,
      targetRevisionId: 3,
      targetCreatedAtMs: 1_000,
      targetRefloatVersion: "1.2.1",
      targetSchema: targetSchema,
      targetRawConfig: targetRaw,
      overlay: overlay
    )

    XCTAssertEqual(Set(plan.changes.keys), ["kp"])
    XCTAssertEqual(plan.changes["kp"] as? Double ?? 0, 25.0, accuracy: 1e-6)
    XCTAssertEqual(plan.skippedFields.map(\.fieldId), ["limit_field"])
    XCTAssertNil(plan.changes["meta.is_default"])
    XCTAssertNil(plan.changes["group_internal"])
    XCTAssertNil(plan.changes["overlay_internal"])
  }

  func testCrossSchemaRevertMapsEnumsByNameAndReportsCurrentOnlyFields() {
    let targetSchema = RefloatConfigSchema(
      hash: "old-schema",
      fields: [
        RefloatConfigSchemaField(
          id: "mode_reordered",
          type: .uint8,
          label: "Reordered Mode",
          unit: nil,
          min: nil,
          max: nil,
          offset: 0,
          scale: nil,
          xmlType: 4,
          enumNames: ["Off", "Cruise", "Trail"]
        ),
        RefloatConfigSchemaField(
          id: "mode_removed_option",
          type: .uint8,
          label: "Removed Option Mode",
          unit: nil,
          min: nil,
          max: nil,
          offset: 1,
          scale: nil,
          xmlType: 4,
          enumNames: ["Off", "Legacy"]
        ),
      ]
    )
    let currentSchema = RefloatConfigSchema(
      hash: "new-schema",
      fields: [
        RefloatConfigSchemaField(
          id: "mode_reordered",
          type: .uint8,
          label: "Reordered Mode",
          unit: nil,
          min: nil,
          max: nil,
          offset: 0,
          scale: nil,
          xmlType: 4,
          enumNames: ["Off", "Custom", "Cruise", "Trail"]
        ),
        RefloatConfigSchemaField(
          id: "mode_removed_option",
          type: .uint8,
          label: "Removed Option Mode",
          unit: nil,
          min: nil,
          max: nil,
          offset: 1,
          scale: nil,
          xmlType: 4,
          enumNames: ["Off", "Modern"]
        ),
        RefloatConfigSchemaField(
          id: "new_writable_field",
          type: .uint8,
          label: "New Writable Field",
          unit: nil,
          min: 0,
          max: 100,
          offset: 2
        ),
        RefloatConfigSchemaField(
          id: "meta.is_default",
          type: .bool,
          label: "Is Default",
          unit: nil,
          min: nil,
          max: nil,
          offset: 3
        ),
      ]
    )

    let plan = BoardConfigRevertPlanner.plan(
      boardId: "board-1",
      currentSchema: currentSchema,
      currentRawConfig: [0, 0, 10, 0],
      targetRevisionId: 9,
      targetCreatedAtMs: 2_000,
      targetRefloatVersion: "1.2.1",
      targetSchema: targetSchema,
      targetRawConfig: [1, 1]
    )

    XCTAssertEqual(Set(plan.changes.keys), ["mode_reordered"])
    XCTAssertEqual(plan.changes["mode_reordered"] as? Double ?? -1, 2.0, accuracy: 1e-6)
    let skippedById = Dictionary(uniqueKeysWithValues: plan.skippedFields.map { ($0.fieldId, $0) })
    XCTAssertTrue(skippedById["mode_removed_option"]?.reason.contains("Legacy") == true)
    XCTAssertEqual(skippedById["new_writable_field"]?.reason, "Not in saved revision")
    XCTAssertNil(skippedById["meta.is_default"])
  }

  func testStorePlanRevertAndSaveRevertRevision() throws {
    let db = try DatabaseQueue()
    try VescapeDatabase.migrator.migrate(db)
    let store = BoardConfigStore(dbWriter: db)

    let schema = try parseFixture("1.3.0")
    let initialRaw = buildDefaultConfigBytes(schema)
    let initialValues = BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "1.3",
      capturedAtMs: 1_000,
      freshness: .fresh,
      values: RefloatConfigFieldDecoder.decodeFieldMap(schema: schema, rawConfig: initialRaw),
      writeBase: BoardConfigWriteBase(schema: schema, rawConfig: initialRaw, packageSignature: 1234),
      refloatVersion: "1.3.0"
    )
    try store.saveWrite(initialValues, source: .external)

    let editedRaw = try RefloatConfigEncoder.encode(
      schema: schema,
      rawConfig: initialRaw,
      fields: ["kp": 30.0]
    )
    let editedValues = BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "1.3",
      capturedAtMs: 2_000,
      freshness: .fresh,
      values: RefloatConfigFieldDecoder.decodeFieldMap(schema: schema, rawConfig: editedRaw),
      writeBase: BoardConfigWriteBase(schema: schema, rawConfig: editedRaw, packageSignature: 1234),
      refloatVersion: "1.3.0"
    )
    try store.saveWrite(editedValues, source: .app)

    let revisionsBefore = try store.loadRevisions(boardId: "board-1")
    XCTAssertEqual(revisionsBefore.count, 2)
    let initialRevisionId = try XCTUnwrap(revisionsBefore.last?.id)

    let plan = try store.planRevert(boardId: "board-1", current: editedValues, revisionId: initialRevisionId)
    XCTAssertTrue(plan.sameSchema)
    XCTAssertEqual(Set(plan.changes.keys), ["kp"])

    let revertedRaw = try RefloatConfigEncoder.encodeChangeset(
      schema: schema,
      rawConfig: editedRaw,
      changes: plan.changes
    ).rawConfig
    XCTAssertEqual(revertedRaw, initialRaw)

    let revertedValues = BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "1.3",
      capturedAtMs: 3_000,
      freshness: .fresh,
      values: RefloatConfigFieldDecoder.decodeFieldMap(schema: schema, rawConfig: revertedRaw),
      writeBase: BoardConfigWriteBase(schema: schema, rawConfig: revertedRaw, packageSignature: 1234),
      refloatVersion: "1.3.0"
    )
    try store.saveWrite(revertedValues, source: .revert)

    let revisionsAfter = try store.loadRevisions(boardId: "board-1")
    XCTAssertEqual(revisionsAfter.count, 3)
    XCTAssertEqual(revisionsAfter[0].source, .revert)
    XCTAssertEqual(revisionsAfter[0].changes.map(\.fieldId), ["kp"])
  }
}
