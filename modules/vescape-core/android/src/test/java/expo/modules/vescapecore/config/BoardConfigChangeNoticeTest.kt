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
  fun diffIgnoresFloatNoiseButKeepsRealEdits() {
    val diffs = BoardConfigChangeNotice.diff(
      old = mapOf("noise" to 0.026000000000002, "edit" to 0.026, "big" to 30000.0),
      new = mapOf("noise" to 0.026, "edit" to 0.027, "big" to 30000.000000001),
      schema = null,
    )
    assertEquals(listOf("edit"), diffs.map { it.fieldId })
  }
}
