package expo.modules.vescapecore.sync

/** What the transport made of one `POST /api/sync`. */
sealed interface SyncResponse {
  /** `2xx`. The body still has to be exactly the accepted map before anything is committed. */
  data class Accepted(val body: String) : SyncResponse

  /** `400`, `409`, `422` or any other unknown `4xx`: wrong request, not a bad moment. */
  data class Invalid(val status: Int, val error: String) : SyncResponse

  /** `401`: the Device Token is dead. Only sign-in resolves it. */
  object Unauthorized : SyncResponse

  /** `413`: over the wire byte bound. Retried with a smaller target, never with fewer rows dropped. */
  object TooLarge : SyncResponse

  /** `429`, with the server's own delay. */
  data class RateLimited(val retryAfterMs: Long) : SyncResponse

  /** `5xx`, a network error or a timeout — the batch may or may not have been applied. */
  data class Transient(val reason: String) : SyncResponse
}

/** @parity /modules/vescape-core/ios/sync/SyncEngine.swift `SyncTransport` */
fun interface SyncTransport {
  suspend fun send(body: String): SyncResponse
}

/**
 * The database side of the uploader: what is pending, and where the cursors are.
 *
 * @parity /modules/vescape-core/ios/sync/SyncEngine.swift `SyncSource`
 */
interface SyncSource {
  /** Pending rows per table, already encoded, capped at [rowLimit] rows in total. */
  suspend fun pending(rowLimit: Int): List<SyncPendingTable>

  /** Rows waiting across every table. Cheap enough to ask on every tick. */
  suspend fun pendingCount(): Int

  /**
   * Commit the advance set in its own transaction, after the response. Never alongside the rows: a
   * cursor advanced past rows the server did not take is unrecoverable, whereas a cursor left behind
   * is a re-send the server upserts idempotently. Always fail toward re-sending.
   *
   * Throws rather than swallowing a write failure: an uncommitted cursor leaves the same rows
   * pending, and a caller that believed the checkpoint landed would resend them without pause.
   */
  suspend fun commit(advances: Map<SyncTable, Long>)

  /**
   * Bumped by an Account change. Captured before a request and re-read before the commit, so a
   * response belonging to the previous Account becomes a no-op instead of advancing a cursor over
   * the fresh database.
   */
  fun generation(): Long

  /** One coalesced, metadata-only Diagnostic Event for a permanent failure. */
  suspend fun recordPermanentFailure(reason: SyncPauseReason, detail: String)
}

/** Environment the policy reads. Owned by the caller, so the engine keeps no platform types. */
data class SyncEnvironment(
  val ridingSamples: Boolean,
  /** The Rider's master switch, read from the App Setting native owns. */
  val enabled: Boolean,
  val online: Boolean,
  val wifiOnly: Boolean,
  val onWifi: Boolean,
  val credentialReady: Boolean,
  val onlineBlocked: Boolean,
)

/** What one pass did, for the loop and for tests. */
sealed interface SyncPass {
  object Idle : SyncPass

  /** Nothing was accepted, but the next attempt differs from this one — a narrowed byte target. */
  object Retry : SyncPass

  data class Sent(val rowCount: Int, val morePending: Boolean) : SyncPass
  data class Waiting(val untilMs: Long) : SyncPass
  data class Paused(val reason: SyncPauseReason) : SyncPass
}

/**
 * The uploader: scan forward from each Sync Cursor, send a small batch, advance only what the server
 * accepted.
 *
 * Owns transport policy, backoff and the permanent pause; the two interesting decisions — which rows
 * go in a batch, and whether to send at all — live in [SyncBatchBuilder] and [SyncPolicy], which are
 * pure. Drives no timer of its own: [SyncCoordinator] owns the loop and the kicks.
 *
 * @parity /modules/vescape-core/ios/sync/SyncEngine.swift `SyncEngine`
 */
class SyncEngine(
  private val source: SyncSource,
  private val transport: SyncTransport,
  private val environment: () -> SyncEnvironment,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  private var retryAtMs = 0L
  private var backoffMs = 0L
  private var byteTarget = MAX_SYNC_BATCH_BYTES
  private var pause: SyncPauseReason? = null

  val pauseReason: SyncPauseReason? get() = pause

  /** Clears a pause. Sign-in and an Account reset are the only things that may. */
  fun resume() {
    pause = null
    retryAtMs = 0
    backoffMs = 0
    byteTarget = MAX_SYNC_BATCH_BYTES
  }

  /**
   * One pass: decide, send, commit. A `200` with rows still pending returns `morePending`, so the
   * loop sends again immediately rather than trickling a long backlog one tick at a time.
   */
  suspend fun runOnce(): SyncPass {
    val env = environment()
    val decision = SyncPolicy.decide(
      SyncState(
        nowMs = clock(),
        pendingRows = source.pendingCount(),
        ridingSamples = env.ridingSamples,
        enabled = env.enabled,
        online = env.online,
        wifiOnly = env.wifiOnly,
        onWifi = env.onWifi,
        credentialReady = env.credentialReady,
        onlineBlocked = env.onlineBlocked,
        pause = pause,
        retryAtMs = retryAtMs,
      ),
    )
    return when (decision) {
      is SyncDecision.Paused -> SyncPass.Paused(decision.reason)
      is SyncDecision.Wait -> SyncPass.Waiting(decision.atMs)
      SyncDecision.SendNow -> send()
    }
  }

  private suspend fun send(): SyncPass {
    // Captured before the rows are read, not after: an Account reset between the scan and the
    // request would otherwise leave a batch of the previous Account's rows looking current, and its
    // cursor advance would land on the fresh database.
    val generation = source.generation()
    val pending = try {
      source.pending(MAX_SYNC_BATCH_ROWS)
    } catch (e: SyncProtocolException) {
      return pauseWith(SyncPauseReason.PROTOCOL, "${e.table.wire}.${e.field}")
    }

    return when (val built = SyncBatchBuilder.build(pending, MAX_SYNC_BATCH_ROWS, byteTarget)) {
      SyncBatchBuild.Empty -> SyncPass.Idle
      is SyncBatchBuild.RowTooLarge ->
        pauseWith(SyncPauseReason.ROW_TOO_LARGE, "${built.table.wire}@${built.cursor}")
      is SyncBatchBuild.Ready -> deliver(built, generation)
    }
  }

  private suspend fun deliver(batch: SyncBatchBuild.Ready, generation: Long): SyncPass {
    val response = transport.send(batch.body)
    // A response that outlived its Account cannot touch the fresh database it would land in.
    if (source.generation() != generation) return SyncPass.Idle

    return when (response) {
      is SyncResponse.Accepted -> accept(batch, response.body)
      SyncResponse.Unauthorized -> pauseWith(SyncPauseReason.AUTHENTICATION, "401")
      is SyncResponse.Invalid ->
        pauseWith(SyncPauseReason.PROTOCOL, "${response.status}:${response.error}")
      SyncResponse.TooLarge -> shrink(batch)
      is SyncResponse.RateLimited -> backOff(maxOf(response.retryAfterMs, 0L))
      is SyncResponse.Transient -> backOff(SyncPolicy.nextBackoffMs(backoffMs).also { backoffMs = it })
    }
  }

  private suspend fun accept(batch: SyncBatchBuild.Ready, body: String): SyncPass {
    val accepted = SyncAccepted.parse(body)
    if (accepted == null || !SyncAccepted.matches(batch.counts, accepted)) {
      return pauseWith(SyncPauseReason.PROTOCOL, "acceptedMismatch")
    }
    try {
      source.commit(batch.advances)
    } catch (e: Exception) {
      // The server took the rows but the checkpoint did not land. Backing off re-sends the identical
      // batch, which the server upserts idempotently — reporting success here would spin instead,
      // because the same rows are still pending.
      backoffMs = SyncPolicy.nextBackoffMs(backoffMs)
      return backOff(backoffMs)
    }
    backoffMs = 0
    retryAtMs = 0
    byteTarget = MAX_SYNC_BATCH_BYTES
    return SyncPass.Sent(batch.rowCount, morePending = source.pendingCount() > 0)
  }

  /**
   * `413` narrows the byte target instead of dropping anything. Once the target can no longer hold
   * even one row, that row is a permanent local protocol error — it is retained, not skipped.
   */
  private suspend fun shrink(batch: SyncBatchBuild.Ready): SyncPass {
    val table = batch.counts.keys.first()
    val detail = "${table.wire}@${batch.advances.getValue(table)}"
    if (batch.rowCount <= 1) return pauseWith(SyncPauseReason.ROW_TOO_LARGE, detail)
    // Already as small as a batch gets: halving again would resend the same bytes forever, so the
    // disagreement about the wire limit is treated as what it is — permanent, with the rows kept.
    if (byteTarget <= MIN_BYTE_TARGET) return pauseWith(SyncPauseReason.ROW_TOO_LARGE, detail)

    byteTarget = maxOf(byteTarget / 2, MIN_BYTE_TARGET)
    return SyncPass.Retry
  }

  private fun backOff(delayMs: Long): SyncPass {
    retryAtMs = clock() + delayMs
    return SyncPass.Waiting(retryAtMs)
  }

  private suspend fun pauseWith(reason: SyncPauseReason, detail: String): SyncPass {
    pause = reason
    source.recordPermanentFailure(reason, detail)
    return SyncPass.Paused(reason)
  }

  private companion object {
    /** Below this a batch cannot hold a realistic row, so shrinking further only hides the real fault. */
    const val MIN_BYTE_TARGET = 16 * 1024
  }
}
