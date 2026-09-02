package expo.modules.vescapecore.sync

/**
 * One row waiting to be uploaded: its cursor position and the compact JSON the server will read.
 *
 * The JSON is encoded once, by the wire layer, so the builder measures the bytes that will actually
 * be sent rather than estimating from an object graph.
 *
 * @parity /modules/vescape-core/ios/sync/SyncBatchBuilder.swift `SyncPendingRow`
 */
data class SyncPendingRow(val cursor: Long, val json: String) {
  val byteCount: Int = json.toByteArray(Charsets.UTF_8).size
}

/** One table's pending rows, in cursor order. */
data class SyncPendingTable(val table: SyncTable, val rows: List<SyncPendingRow>)

/**
 * What the builder made of the pending rows.
 *
 * @parity /modules/vescape-core/ios/sync/SyncBatchBuilder.swift `SyncBatchBuild`
 */
sealed interface SyncBatchBuild {
  /** Nothing pending. */
  object Empty : SyncBatchBuild

  /**
   * A batch and the cursor advance set describing exactly the rows in it. Cursors are committed only
   * after the server accepts, and only these positions move.
   */
  data class Ready(
    val body: String,
    val counts: Map<SyncTable, Int>,
    val advances: Map<SyncTable, Long>,
    val rowCount: Int,
    val byteCount: Int,
  ) : SyncBatchBuild

  /**
   * One row cannot fit a batch of its own. Never skipped and never quarantined: the engine pauses
   * with the row retained, because dropping it would silently lose data a Rider believes is backed
   * up.
   */
  data class RowTooLarge(val table: SyncTable, val cursor: Long, val byteCount: Int) : SyncBatchBuild
}

/**
 * Fills a Sync Batch from per-table pending rows.
 *
 * Pure: no database, no clock, no network. It walks [SyncTable] declaration order — the order the
 * server applies a batch in — and stops at whichever cap comes first. Ordering by backlog size would
 * produce a batch whose children arrive before their parents, which the server refuses whole.
 *
 * @parity /modules/vescape-core/ios/sync/SyncBatchBuilder.swift `SyncBatchBuilder`
 */
object SyncBatchBuilder {
  fun build(
    pending: List<SyncPendingTable>,
    rowCap: Int = MAX_SYNC_BATCH_ROWS,
    byteCap: Int = MAX_SYNC_BATCH_BYTES,
  ): SyncBatchBuild {
    val ordered = pending
      .filter { it.rows.isNotEmpty() }
      .sortedBy { it.table.ordinal }
    if (ordered.isEmpty()) return SyncBatchBuild.Empty

    val body = StringBuilder("{")
    val counts = LinkedHashMap<SyncTable, Int>()
    val advances = LinkedHashMap<SyncTable, Long>()
    var rowCount = 0
    // `{}`; every other cost below is added as the exact bytes appended.
    var byteCount = 2

    for (group in ordered) {
      if (rowCount >= rowCap) break
      // `,"appSettings":[]` — the separating comma only once a table is already open.
      val header = (if (counts.isEmpty()) "" else ",") + "\"" + group.table.wire + "\":["
      val tableOverhead = header.length + 1
      if (byteCount + tableOverhead > byteCap) break

      var opened = false
      var truncated = false
      for (row in group.rows) {
        if (rowCount >= rowCap) break
        val rowCost = row.byteCount + if (opened) 1 else 0
        val overhead = if (opened) 0 else tableOverhead
        if (byteCount + overhead + rowCost > byteCap) {
          // A row no empty batch could carry is a permanent local protocol error, not a cap hit.
          if (counts.isEmpty() && !opened && 2 + tableOverhead + row.byteCount > byteCap) {
            return SyncBatchBuild.RowTooLarge(group.table, row.cursor, row.byteCount)
          }
          truncated = true
          break
        }

        if (!opened) {
          body.append(header)
          byteCount += tableOverhead
          counts[group.table] = 0
          opened = true
        } else {
          body.append(',')
        }
        body.append(row.json)
        byteCount += rowCost
        rowCount += 1
        counts[group.table] = counts.getValue(group.table) + 1
        advances[group.table] = row.cursor
      }
      if (opened) body.append(']')
      // A table cut short by the byte cap may still hold a parent — a Board whose settings, alerts
      // or Tune Profiles sit further down this same batch. Carrying on would send the child ahead of
      // it, and the server refuses that whole batch on the foreign key. The rest waits for the next
      // batch, which starts where this one stopped.
      if (truncated) break
    }

    if (counts.isEmpty()) return SyncBatchBuild.Empty
    body.append('}')
    return SyncBatchBuild.Ready(
      body = body.toString(),
      counts = counts,
      advances = advances,
      rowCount = rowCount,
      byteCount = byteCount,
    )
  }
}
