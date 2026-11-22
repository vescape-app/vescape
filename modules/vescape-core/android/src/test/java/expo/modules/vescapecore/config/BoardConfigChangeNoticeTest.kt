package expo.modules.vescapecore.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BoardConfigChangeNoticeTest {
  @Test
  fun diffPreservesTypesAndAddedRemovedFields() {
    val diffs = BoardConfigChangeNotice.diff(
      old = mapOf("same" to 1.0, "typed" to 1.0, "removed" to false),
      new = mapOf("same" to 1.0, "typed" to true, "added" to 2.0),
      schema = null,
    )
    assertEquals(listOf("added", "removed", "typed"), diffs.map { it.fieldId })
    assertNull(diffs[0].oldValue)
    assertEquals(2.0, diffs[0].newValue)
    assertEquals(false, diffs[1].oldValue)
    assertNull(diffs[1].newValue)
    assertEquals(1.0, diffs[2].oldValue)
    assertEquals(true, diffs[2].newValue)
  }

  @Test
  fun mergeKeepsOneEntryPerFieldWithTheNewerComparison() {
    val previous = listOf(
      BoardConfigChangeDiff("fault_adc1", "Zone 1", "V", 1.0, 1.2),
      BoardConfigChangeDiff("l_temp_fet_start", "l_temp_fet_start", null, 70.0, 75.0),
    )
    val incoming = listOf(
      BoardConfigChangeDiff("l_temp_fet_start", "l_temp_fet_start", null, 75.0, 80.0),
      BoardConfigChangeDiff("l_current_max", "l_current_max", null, 160.0, 150.0),
    )

    val merged = BoardConfigChangeNotice.mergeDiffs(previous, incoming)

    assertEquals(listOf("fault_adc1", "l_temp_fet_start", "l_current_max"), merged.map { it.fieldId })
    assertEquals(75.0, merged[1].oldValue)
    assertEquals(80.0, merged[1].newValue)
  }

  @Test
  fun diffIgnoresFloatNoiseButKeepsRealEdits() {
    val diffs = BoardConfigChangeNotice.diff(
      old = mapOf("noise" to 0.026000000000002, "edit" to 0.026, "big" to 30000.0),
      new = mapOf("noise" to 0.026, "edit" to 0.027, "big" to 30000.000000001),
      schema = null,
    )
    assertEquals(listOf("edit"), diffs.map { it.fieldId })
  }

  @Test
  fun diffSkipsIgnoredAndVolatileMotorFields() {
    val old = mapOf<String, Any>(
      "foc_offsets_current[0]" to 2010.43,
      "foc_offsets_current[1]" to 2031.32,
      "foc_offsets_current[2]" to 2040.56,
      "foc_offsets_voltage[0]" to -0.0062,
      "foc_offsets_voltage[1]" to 0.001,
      "foc_offsets_voltage[2]" to 0.0025,
      "foc_offsets_voltage_undriven[0]" to 0.001,
      "foc_offsets_voltage_undriven[1]" to 0.002,
      "foc_offsets_voltage_undriven[2]" to 0.003,
      "foc_offsets_cal_on_boot" to 1.0,
      "l_current_max" to 160.0,
      "l_temp_fet_start" to 70.0,
    )
    val new = mapOf<String, Any>(
      "foc_offsets_current[0]" to 2010.67,
      "foc_offsets_current[1]" to 2031.66,
      "foc_offsets_current[2]" to 2040.22,
      "foc_offsets_voltage[0]" to -0.0061,
      "foc_offsets_voltage[1]" to 0.002,
      "foc_offsets_voltage[2]" to 0.0024,
      "foc_offsets_voltage_undriven[0]" to 0.004,
      "foc_offsets_voltage_undriven[1]" to 0.005,
      "foc_offsets_voltage_undriven[2]" to 0.006,
      "foc_offsets_cal_on_boot" to 0.0,
      "l_current_max" to 150.0,
      "l_temp_fet_start" to 75.0,
    )
    val diffs = BoardConfigChangeNotice.diff(
      old = old,
      new = new,
      schema = null,
      ignoredFields = BoardConfigChangeNotice.VOLATILE_MOTOR_FIELDS + "l_current_max",
    )
    assertEquals(listOf("foc_offsets_cal_on_boot", "l_temp_fet_start"), diffs.map { it.fieldId })
  }

  @Test
  fun decodeIgnoredFieldsFiltersEmptyAndNonStringEntries() {
    var invalidCount = 0
    assertEquals(
      listOf("l_current_max", "kp"),
      BoardConfigChangeNotice.decodeIgnoredFields("""["l_current_max", "", 42, "kp", "l_current_max"]""") { invalidCount++ },
    )
    assertEquals(0, invalidCount)
    assertEquals(emptyList<String>(), BoardConfigChangeNotice.decodeIgnoredFields(null) { invalidCount++ })
    assertEquals(0, invalidCount)
    assertEquals(emptyList<String>(), BoardConfigChangeNotice.decodeIgnoredFields("{}") { invalidCount++ })
    assertEquals(emptyList<String>(), BoardConfigChangeNotice.decodeIgnoredFields("not json") { invalidCount++ })
    assertEquals(2, invalidCount)
  }
}
