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

    // The Refloat diff survives, the twice-diffed field keeps its slot with the newer values, and the
    // new field lands last.
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
}
