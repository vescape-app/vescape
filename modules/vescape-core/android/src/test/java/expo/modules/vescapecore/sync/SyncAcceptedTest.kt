package expo.modules.vescapecore.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The `200` body is the last thing standing between an accepted batch and a cursor that can never be
 * walked back, so it is validated exactly rather than trusted.
 *
 * @parity /modules/vescape-core/ios/sync/SyncAcceptedTests.swift
 */
class SyncAcceptedTest {
  private fun body(counts: Map<SyncTable, Int> = emptyMap(), tables: List<SyncTable> = SyncTable.entries): String {
    val pairs = tables.joinToString(",") { "\"${it.wire}\":${counts[it] ?: 0}" }
    return "{\"accepted\":{$pairs}}"
  }

  @Test
  fun `every table accounted for parses`() {
    val parsed = SyncAccepted.parse(body(mapOf(SyncTable.BOARDS to 3)))
    assertEquals(3, parsed?.get(SyncTable.BOARDS))
    assertEquals(0, parsed?.get(SyncTable.FAVORITES))
  }

  @Test
  fun `a missing table, an extra table or a duplicate is refused`() {
    assertNull(SyncAccepted.parse(body(tables = SyncTable.entries.drop(1))))
    assertNull(SyncAccepted.parse("{\"accepted\":{\"unknownTable\":0}}"))
    assertNull(SyncAccepted.parse("{\"accepted\":{\"boards\":1,\"boards\":1}}"))
  }

  @Test
  fun `anything that is not this response is refused rather than half-read`() {
    assertNull(SyncAccepted.parse(""))
    assertNull(SyncAccepted.parse("{}"))
    assertNull(SyncAccepted.parse("{\"ok\":true}"))
    assertNull(SyncAccepted.parse(body() + "trailing"))
  }

  @Test
  fun `counts have to equal what was submitted, table by table`() {
    val submitted = mapOf(SyncTable.BOARDS to 2)
    assertTrue(SyncAccepted.matches(submitted, SyncAccepted.parse(body(submitted))!!))
    assertFalse(
      SyncAccepted.matches(submitted, SyncAccepted.parse(body(mapOf(SyncTable.BOARDS to 1)))!!),
    )
    assertFalse(
      SyncAccepted.matches(
        submitted,
        SyncAccepted.parse(body(mapOf(SyncTable.BOARDS to 2, SyncTable.ALERTS to 1)))!!,
      ),
    )
  }
}
