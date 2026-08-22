package expo.modules.vescapecore.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The batch builder is pure: no database, no clock, no network. What it has to get right is the
 * order tables go out in, the two caps, and an advance set that describes exactly the rows sent.
 *
 * @parity /modules/vescape-core/ios/sync/SyncBatchBuilderTests.swift
 */
class SyncBatchBuilderTest {
  private fun rows(count: Int, size: Int = 10, from: Long = 1): List<SyncPendingRow> =
    (0 until count).map { SyncPendingRow(from + it, "\"" + "x".repeat(size) + "\"") }

  @Test
  fun `walks server table order regardless of backlog size`() {
    val built = SyncBatchBuilder.build(
      listOf(
        SyncPendingTable(SyncTable.TELEMETRY_FRAMES, rows(5)),
        SyncPendingTable(SyncTable.BOARDS, rows(1)),
        SyncPendingTable(SyncTable.APP_SETTINGS, rows(1)),
      ),
    ) as SyncBatchBuild.Ready

    assertEquals(
      listOf(SyncTable.APP_SETTINGS, SyncTable.BOARDS, SyncTable.TELEMETRY_FRAMES),
      built.counts.keys.toList(),
    )
    assertTrue(built.body.indexOf("appSettings") < built.body.indexOf("boards"))
    assertTrue(built.body.indexOf("boards") < built.body.indexOf("telemetryFrames"))
  }

  @Test
  fun `advance set names the last row actually included, per table`() {
    val built = SyncBatchBuilder.build(
      listOf(
        SyncPendingTable(SyncTable.BOARDS, rows(2, from = 40)),
        SyncPendingTable(SyncTable.FAVORITES, rows(3, from = 7)),
      ),
      rowCap = 4,
    ) as SyncBatchBuild.Ready

    assertEquals(4, built.rowCount)
    assertEquals(mapOf(SyncTable.BOARDS to 2, SyncTable.FAVORITES to 2), built.counts)
    assertEquals(mapOf(SyncTable.BOARDS to 41L, SyncTable.FAVORITES to 8L), built.advances)
  }

  @Test
  fun `exactly-at and one-over the row cap behave the same way on every platform`() {
    val atCap = SyncBatchBuilder.build(
      listOf(SyncPendingTable(SyncTable.BOARDS, rows(3))),
      rowCap = 3,
    ) as SyncBatchBuild.Ready
    assertEquals(3, atCap.rowCount)

    val overCap = SyncBatchBuilder.build(
      listOf(SyncPendingTable(SyncTable.BOARDS, rows(4))),
      rowCap = 3,
    ) as SyncBatchBuild.Ready
    assertEquals(3, overCap.rowCount)
    assertEquals(3L, overCap.advances.getValue(SyncTable.BOARDS))
  }

  /** The cap is on the bytes actually sent, so the encoded body is what gets measured. */
  @Test
  fun `byte cap counts the encoded body, boundary included`() {
    val one = SyncBatchBuilder.build(
      listOf(SyncPendingTable(SyncTable.BOARDS, rows(2, size = 8))),
      byteCap = Int.MAX_VALUE,
    ) as SyncBatchBuild.Ready
    assertEquals(one.body.toByteArray(Charsets.UTF_8).size, one.byteCount)

    val atCap = SyncBatchBuilder.build(
      listOf(SyncPendingTable(SyncTable.BOARDS, rows(2, size = 8))),
      byteCap = one.byteCount,
    ) as SyncBatchBuild.Ready
    assertEquals(2, atCap.rowCount)

    val oneUnder = SyncBatchBuilder.build(
      listOf(SyncPendingTable(SyncTable.BOARDS, rows(2, size = 8))),
      byteCap = one.byteCount - 1,
    ) as SyncBatchBuild.Ready
    assertEquals(1, oneUnder.rowCount)
    assertEquals(oneUnder.body.toByteArray(Charsets.UTF_8).size, oneUnder.byteCount)
  }

  /** Multi-byte characters count as their UTF-8 bytes, not as characters. */
  @Test
  fun `measures utf-8 bytes rather than characters`() {
    val row = SyncPendingRow(1, "\"ąęółśż\"")
    val built = SyncBatchBuilder.build(
      listOf(SyncPendingTable(SyncTable.BOARDS, listOf(row))),
    ) as SyncBatchBuild.Ready
    assertEquals(built.body.toByteArray(Charsets.UTF_8).size, built.byteCount)
  }

  @Test
  fun `a row no empty batch could carry is a permanent error, not a silent skip`() {
    val huge = SyncPendingRow(9, "\"" + "x".repeat(500) + "\"")
    val built = SyncBatchBuilder.build(
      listOf(SyncPendingTable(SyncTable.BOARDS, listOf(huge))),
      byteCap = 100,
    )
    assertEquals(SyncBatchBuild.RowTooLarge(SyncTable.BOARDS, 9, huge.byteCount), built)
  }

  /**
   * A Board left behind by the byte cap must not be followed by its Alert Rules in the same batch —
   * the server writes them in this order and refuses the whole batch on the foreign key.
   */
  @Test
  fun `a table truncated by the byte cap ends the batch instead of sending children`() {
    val full = SyncBatchBuilder.build(
      listOf(
        SyncPendingTable(SyncTable.BOARDS, rows(2, size = 40)),
        SyncPendingTable(SyncTable.ALERTS, rows(1, size = 4)),
      ),
      byteCap = Int.MAX_VALUE,
    ) as SyncBatchBuild.Ready
    assertEquals(3, full.rowCount)

    val truncated = SyncBatchBuilder.build(
      listOf(
        SyncPendingTable(SyncTable.BOARDS, rows(2, size = 40)),
        SyncPendingTable(SyncTable.ALERTS, rows(1, size = 4)),
      ),
      byteCap = full.byteCount - 20,
    ) as SyncBatchBuild.Ready

    assertEquals(listOf(SyncTable.BOARDS), truncated.counts.keys.toList())
    assertEquals(1, truncated.counts.getValue(SyncTable.BOARDS))
    assertEquals(truncated.body.toByteArray(Charsets.UTF_8).size, truncated.byteCount)
  }

  @Test
  fun `nothing pending is idle, not an empty batch`() {
    assertEquals(SyncBatchBuild.Empty, SyncBatchBuilder.build(emptyList()))
    assertEquals(
      SyncBatchBuild.Empty,
      SyncBatchBuilder.build(listOf(SyncPendingTable(SyncTable.BOARDS, emptyList()))),
    )
  }
}
