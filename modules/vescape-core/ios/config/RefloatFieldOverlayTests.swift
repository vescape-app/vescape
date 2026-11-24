import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/RefloatFieldOverlayTest.kt
final class RefloatFieldOverlayTests: XCTestCase {
  func testBundledOverlayMarksMetaIsDefaultInternalAndAllowsSoftOutliers() throws {
    XCTAssertTrue(RefloatFieldOverlay.shared.isInternal("meta.is_default"))
    XCTAssertEqual(RefloatFieldOverlay.shared.entry("fault_is_dual_switch")?.risk, .risky)
    XCTAssertFalse(RefloatFieldOverlay.shared.isInternal("atr_strength_up"))

    let atrField = RefloatConfigSchemaField(
      id: "atr_strength_up",
      type: .float16Scaled,
      label: "ATR Uphill Strength",
      unit: nil,
      min: 0.0,
      max: 3.5,
      offset: 0,
      scale: 1000.0
    )
    let range = try XCTUnwrap(RefloatConfigEncoder.effectiveRange(atrField))
    XCTAssertEqual(range.min, 0.0, accuracy: 1e-9)
    XCTAssertEqual(range.max, 3.5, accuracy: 1e-9)

    let schema = RefloatConfigSchema(hash: "h", fields: [atrField])
    let encoded = try RefloatConfigEncoder.encodeChangeset(
      schema: schema,
      rawConfig: [0, 0],
      changes: ["atr_strength_up": 2.5]
    )
    XCTAssertEqual(encoded.changedFieldIds, ["atr_strength_up"])
  }

  func testEncoderRejectsInternalFields() {
    let field = RefloatConfigSchemaField(
      id: "meta.is_default",
      type: .bool,
      label: "Config is Default",
      unit: nil,
      min: nil,
      max: nil,
      offset: 0
    )
    let schema = RefloatConfigSchema(hash: "h", fields: [field])
    XCTAssertThrowsError(
      try RefloatConfigEncoder.encodeChangeset(
        schema: schema,
        rawConfig: [0],
        changes: ["meta.is_default": true]
      )
    ) { error in
      XCTAssertEqual((error as? RefloatConfigEncodeException)?.code, .CONFIG_VALUE_INVALID)
    }
  }

  func testEffectiveRangeIntersectsSchemaWireAndHardLimit() throws {
    let field = RefloatConfigSchemaField(
      id: "kp",
      type: .float16Scaled,
      label: "Angle P",
      unit: nil,
      min: 0.0,
      max: 40.0,
      offset: 0,
      scale: 10.0
    )
    let overlay = RefloatFieldOverlay(entries: [
      "kp": RefloatFieldOverlayEntry(hardMin: 5.0, hardMax: 30.0)
    ])
    let range = try XCTUnwrap(RefloatConfigEncoder.effectiveRange(field, overlay: overlay))
    XCTAssertEqual(range.min, 5.0, accuracy: 1e-9)
    XCTAssertEqual(range.max, 30.0, accuracy: 1e-9)

    let schema = RefloatConfigSchema(hash: "h", fields: [field])
    let ok = try RefloatConfigEncoder.encodeChangeset(
      schema: schema,
      rawConfig: [0, 0],
      changes: ["kp": 30.0],
      overlay: overlay
    )
    XCTAssertEqual(ok.changedFieldIds, ["kp"])

    XCTAssertThrowsError(
      try RefloatConfigEncoder.encodeChangeset(
        schema: schema,
        rawConfig: [0, 0],
        changes: ["kp": 30.5],
        overlay: overlay
      )
    ) { error in
      XCTAssertEqual((error as? RefloatConfigEncodeException)?.code, .CONFIG_VALUE_INVALID)
    }

    XCTAssertThrowsError(
      try RefloatConfigEncoder.encodeChangeset(
        schema: schema,
        rawConfig: [0, 0],
        changes: ["kp": 4.5],
        overlay: overlay
      )
    ) { error in
      XCTAssertEqual((error as? RefloatConfigEncodeException)?.code, .CONFIG_VALUE_INVALID)
    }
  }
}
