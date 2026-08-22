package expo.modules.vescapecore.sync

import org.json.JSONObject

/**
 * A server that stores what it is sent and answers with the accepted map the real one would.
 *
 * It exists so a test can assert the only thing that matters end to end: every row the Rider owns
 * reached the server. The engine's own return values cannot show that — a cursor advanced past a row
 * that was never in a batch reports `Sent` and looks identical to a correct pass.
 *
 * Stores rows by identity and upserts, exactly like the real one, so a re-send after a lost
 * checkpoint is a no-op rather than a duplicate.
 *
 * @parity /modules/vescape-core/ios/sync/FakeSyncServer.swift `FakeSyncServer`
 */
class FakeSyncServer : SyncTransport {

  /** Every row the server holds, by table and cursor. */
  val stored = mutableSetOf<Pair<SyncTable, Long>>()

  /** Bodies received, including the ones answered with a failure. */
  val received = mutableListOf<String>()

  /** Rows written, counting re-sends — the cost of failing toward re-sending. */
  var writes = 0
    private set

  /** Queued failures, consumed one per request before the server stores anything. */
  val failures = ArrayDeque<SyncResponse>()

  /** Fires after the batch is stored but before the response is returned. */
  var afterStore: (() -> Unit)? = null

  /**
   * Store the next batch and then answer as if the response never arrived. The engine cannot tell
   * this apart from a batch that was never applied, which is exactly why it re-sends.
   */
  var loseNextResponse = false

  private val byWire = SyncTable.entries.associateBy { it.wire }

  override suspend fun send(body: String): SyncResponse {
    received += body
    failures.removeFirstOrNull()?.let { return it }

    val batch = JSONObject(body)
    val counts = LinkedHashMap<SyncTable, Int>()
    for (wire in batch.keys()) {
      val table = byWire.getValue(wire)
      val rows = batch.getJSONArray(wire)
      counts[table] = rows.length()
      for (i in 0 until rows.length()) {
        stored += table to rows.getJSONObject(i).getLong("c")
        writes += 1
      }
    }
    afterStore?.invoke()
    if (loseNextResponse) {
      loseNextResponse = false
      return SyncResponse.Transient("timeout")
    }
    return SyncResponse.Accepted(accepted(counts))
  }

  /** The server answers for every table it knows, not only the ones the batch carried. */
  private fun accepted(counts: Map<SyncTable, Int>): String {
    val body = SyncTable.entries.joinToString(",") { "\"${it.wire}\":${counts[it] ?: 0}" }
    return "{\"accepted\":{$body}}"
  }
}
