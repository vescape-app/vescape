package expo.modules.vescapecore.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

// @parity /modules/vescape-core/ios/config/RefloatFieldOverlayTests.swift
class RefloatFieldOverlayTest {
  @Test
  fun bundledOverlayMarksMetaIsDefaultInternalAndAllowsSoftOutliers() {
    assertTrue(RefloatFieldOverlay.shared.isInternal("meta.is_default"))
    assertEquals(RefloatFieldRisk.RISKY, RefloatFieldOverlay.shared.entry("fault_adc1")?.risk)
    assertFalse(RefloatFieldOverlay.shared.isInternal("atr_strength_up"))

    val atrField = RefloatConfigSchemaField(
      id = "atr_strength_up",
      type = RefloatConfigValueType.FLOAT16_SCALED,
      label = "ATR Uphill Strength",
      unit = null,
      min = 0.0,
      max = 3.5,
      offset = 0,
      scale = 1000.0,
    )
    val range = RefloatConfigEncoder.effectiveRange(atrField)!!
    assertEquals(0.0, range.min, 1e-9)
    assertEquals(3.5, range.max, 1e-9)

    val schema = RefloatConfigSchema("h", listOf(atrField))
    val encoded = RefloatConfigEncoder.encodeChangeset(schema, ByteArray(2), mapOf("atr_strength_up" to 2.5))
    assertEquals(setOf("atr_strength_up"), encoded.changedFieldIds)
  }

  @Test
  fun encoderRejectsInternalFields() {
    val field = RefloatConfigSchemaField(
      id = "meta.is_default",
      type = RefloatConfigValueType.BOOL,
      label = "Config is Default",
      unit = null,
      min = null,
      max = null,
      offset = 0,
    )
    val schema = RefloatConfigSchema("h", listOf(field))
    val error = assertThrows(RefloatConfigEncodeException::class.java) {
      RefloatConfigEncoder.encodeChangeset(schema, byteArrayOf(0), mapOf("meta.is_default" to true))
    }
    assertEquals(RefloatConfigErrorCode.CONFIG_VALUE_INVALID, error.code)
  }

  @Test
  fun effectiveRangeIntersectsSchemaWireAndHardLimit() {
    val field = RefloatConfigSchemaField(
      id = "kp",
      type = RefloatConfigValueType.FLOAT16_SCALED,
      label = "Angle P",
      unit = null,
      min = 0.0,
      max = 40.0,
      offset = 0,
      scale = 10.0,
    )
    val overlay = RefloatFieldOverlay(
      mapOf("kp" to RefloatFieldOverlayEntry(hardMin = 5.0, hardMax = 30.0)),
    )
    val range = RefloatConfigEncoder.effectiveRange(field, overlay)!!
    assertEquals(5.0, range.min, 1e-9)
    assertEquals(30.0, range.max, 1e-9)

    val schema = RefloatConfigSchema("h", listOf(field))
    assertEquals(
      setOf("kp"),
      RefloatConfigEncoder.encodeChangeset(schema, ByteArray(2), mapOf("kp" to 30.0), overlay).changedFieldIds,
    )
    val above = assertThrows(RefloatConfigEncodeException::class.java) {
      RefloatConfigEncoder.encodeChangeset(schema, ByteArray(2), mapOf("kp" to 30.5), overlay)
    }
    assertEquals(RefloatConfigErrorCode.CONFIG_VALUE_INVALID, above.code)
    val below = assertThrows(RefloatConfigEncodeException::class.java) {
      RefloatConfigEncoder.encodeChangeset(schema, ByteArray(2), mapOf("kp" to 4.5), overlay)
    }
    assertEquals(RefloatConfigErrorCode.CONFIG_VALUE_INVALID, below.code)
  }
}
