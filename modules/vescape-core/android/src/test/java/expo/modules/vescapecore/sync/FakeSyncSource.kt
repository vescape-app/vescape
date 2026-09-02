package expo.modules.vescapecore.sync

/**
 * A [SyncSource] that models the database the way [SyncStore] actually behaves: rows keyed by their
 * cursor position, a scan that serves strictly `cursor > committed` in ascending order, and a commit
 * that ratchets each table's cursor forward and never backwards.
 *
 * The point of modelling it rather than counting is that the loss bug is a cursor bug. A source that
 * decrements a row counter accepts an advance set that names the wrong position — the exact mistake
 * that makes a row unreachable forever — because the next scan is not derived from what was
 * committed. Here it is, so a wrong advance shows up as a row nobody is ever offered again.
 *
 * @parity /modules/vescape-core/ios/sync/FakeSyncSource.swift `FakeSyncSource`
 */
class FakeSyncSource(seed: Map<SyncTable, List<Long>> = emptyMap()) : SyncSource {

  constructor(rows: Int) : this(mapOf(SyncTable.BOARDS to (1L..rows.toLong()).toList()))

  /** Cursor positions present per table, ascending — the rows on disk. */
  private val rows: Map<SyncTable, List<Long>> =
    seed.mapValues { (_, positions) -> positions.sorted() }

  /** How far each table has been accepted. Absent means nothing delivered. */
  val cursors = mutableMapOf<SyncTable, Long>()

  /** Every advance set handed to [commit], in order. */
  val committed = mutableListOf<Map<SyncTable, Long>>()

  /** Every row the scan handed out, in order, across every pass. Re-sends appear more than once. */
  val offered = mutableListOf<Pair<SyncTable, Long>>()

  var generation = 0L
  val failures = mutableListOf<Pair<SyncPauseReason, String>>()
  var encodeFailure: SyncProtocolException? = null
  var commitFailure: Exception? = null
  /** Caps one scan below the engine's own row limit, so a drain takes more than one pass. */
  var scanLimit = Int.MAX_VALUE

  /**
   * Each row carries its own cursor on the wire, so a fake server can report back exactly which
   * rows it stored. Without row identity in the body, "the server received everything" is not a
   * claim a test can make.
   */
  private fun rowJson(cursor: Long) = "{\"c\":$cursor}"

  /** Rows the scan will still offer. Zero means the backlog is drained. */
  val remaining: Int
    get() = rows.entries.sumOf { (table, positions) -> positions.count { it > cursorOf(table) } }

  private fun cursorOf(table: SyncTable): Long = cursors[table] ?: 0L

  /** Mirrors [SyncStore.pending]: table order, one shared row budget, forward from each cursor. */
  override suspend fun pending(rowLimit: Int): List<SyncPendingTable> {
    encodeFailure?.let { throw it }
    val tables = mutableListOf<SyncPendingTable>()
    var budget = minOf(rowLimit, scanLimit)
    for (table in SyncTable.entries) {
      if (budget <= 0) break
      val positions = rows[table] ?: continue
      val pending = positions.filter { it > cursorOf(table) }.take(budget)
      if (pending.isEmpty()) continue
      pending.forEach { offered += table to it }
      tables += SyncPendingTable(table, pending.map { SyncPendingRow(it, rowJson(it)) })
      budget -= pending.size
    }
    return tables
  }

  override suspend fun pendingCount(): Int = remaining

  /** Mirrors `commitSyncCursor`: `MAX(existing, incoming)`, so a cursor never moves backwards. */
  override suspend fun commit(advances: Map<SyncTable, Long>) {
    commitFailure?.let { throw it }
    committed += advances
    for ((table, cursor) in advances) cursors[table] = maxOf(cursorOf(table), cursor)
  }

  override fun generation(): Long = generation

  override suspend fun recordPermanentFailure(reason: SyncPauseReason, detail: String) {
    failures += reason to detail
  }

  /** Every row on disk, for the loss invariant. */
  fun allRows(): Set<Pair<SyncTable, Long>> =
    rows.entries.flatMap { (table, positions) -> positions.map { table to it } }.toSet()
}
