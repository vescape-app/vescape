import Foundation

/// What the transport made of one `POST /api/sync`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncEngine.kt `SyncResponse`
enum SyncResponse {
  /// `2xx`. The body still has to be exactly the accepted map before anything is committed.
  case accepted(body: String)
  /// `400`, `409`, `422` or any other unknown `4xx`: wrong request, not a bad moment.
  case invalid(status: Int, error: String)
  /// `401`: the Device Token is dead. Only sign-in resolves it.
  case unauthorized
  /// `413`: over the wire byte bound. Retried with a smaller target, never with fewer rows dropped.
  case tooLarge
  /// `429`, with the server's own delay.
  case rateLimited(retryAfterMs: Int64)
  /// `5xx`, a network error or a timeout — the batch may or may not have been applied.
  case transient(reason: String)
}

/// The database side of the uploader: what is pending, and where the cursors are.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncEngine.kt `SyncSource`
protocol SyncSource {
  /// Pending rows per table, already encoded, capped at `rowLimit` rows in total.
  func pending(rowLimit: Int) throws -> [SyncPendingTable]

  /// Rows waiting across every table. Cheap enough to ask on every tick.
  func pendingCount() -> Int

  /// Commit the advance set in its own transaction, after the response. Never alongside the rows: a
  /// cursor advanced past rows the server did not take is unrecoverable, whereas a cursor left
  /// behind is a re-send the server upserts idempotently. Always fail toward re-sending.
  ///
  /// Throws rather than swallowing a write failure: an uncommitted cursor leaves the same rows
  /// pending, and a caller that believed the checkpoint landed would resend them without pause.
  func commit(_ advances: [SyncTable: Int64]) throws

  /// Bumped by an Account change. Captured before a request and re-read before the commit, so a
  /// response belonging to the previous Account becomes a no-op instead of advancing a cursor over
  /// the fresh database.
  func generation() -> Int64

  /// One coalesced, metadata-only Diagnostic Event for a permanent failure.
  func recordPermanentFailure(_ reason: SyncPauseReason, detail: String)
}

/// Environment the policy reads. Owned by the caller, so the engine keeps no platform types.
struct SyncEnvironment {
  let ridingSamples: Bool
  /// The Rider's master switch, read from the App Setting native owns.
  let enabled: Bool
  let online: Bool
  let wifiOnly: Bool
  let onWifi: Bool
  let credentialReady: Bool
  let onlineBlocked: Bool
}

/// What one pass did, for the loop and for tests.
enum SyncPass: Equatable {
  case idle
  /// Nothing was accepted, but the next attempt differs from this one — a narrowed byte target.
  case retry
  case sent(rowCount: Int, morePending: Bool)
  case waiting(untilMs: Int64)
  case paused(SyncPauseReason)
}

/// The uploader: scan forward from each Sync Cursor, send a small batch, advance only what the
/// server accepted.
///
/// Owns transport policy, backoff and the permanent pause; the two interesting decisions — which
/// rows go in a batch, and whether to send at all — live in `SyncBatchBuilder` and `SyncPolicy`,
/// which are pure. Drives no timer of its own: `SyncCoordinator` owns the loop and the kicks.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncEngine.kt `SyncEngine`
final class SyncEngine {
  /// Below this a batch cannot hold a realistic row, so shrinking further only hides the real fault.
  private static let minByteTarget = 16 * 1024

  private let source: SyncSource
  private let transport: (String) async -> SyncResponse
  private let environment: () -> SyncEnvironment
  private let clock: () -> Int64

  private var retryAtMs: Int64 = 0
  private var backoffMs: Int64 = 0
  private var byteTarget = maxSyncBatchBytes
  private(set) var pauseReason: SyncPauseReason?

  init(
    source: SyncSource,
    transport: @escaping (String) async -> SyncResponse,
    environment: @escaping () -> SyncEnvironment,
    clock: @escaping () -> Int64 = { telemetryNowMs() }
  ) {
    self.source = source
    self.transport = transport
    self.environment = environment
    self.clock = clock
  }

  /// Clears a pause. Sign-in and an Account reset are the only things that may.
  func resume() {
    pauseReason = nil
    retryAtMs = 0
    backoffMs = 0
    byteTarget = maxSyncBatchBytes
  }

  /// One pass: decide, send, commit. A `200` with rows still pending returns `morePending`, so the
  /// loop sends again immediately rather than trickling a long backlog one tick at a time.
  func runOnce() async -> SyncPass {
    let env = environment()
    let decision = SyncPolicy.decide(
      SyncState(
        nowMs: clock(),
        pendingRows: source.pendingCount(),
        ridingSamples: env.ridingSamples,
        enabled: env.enabled,
        online: env.online,
        wifiOnly: env.wifiOnly,
        onWifi: env.onWifi,
        credentialReady: env.credentialReady,
        onlineBlocked: env.onlineBlocked,
        pause: pauseReason,
        retryAtMs: retryAtMs
      )
    )
    switch decision {
    case .paused(let reason): return .paused(reason)
    case .wait(let atMs): return .waiting(untilMs: atMs)
    case .sendNow: return await send()
    }
  }

  private func send() async -> SyncPass {
    // Captured before the rows are read, not after: an Account reset between the scan and the
    // request would otherwise leave a batch of the previous Account's rows looking current, and its
    // cursor advance would land on the fresh database.
    let generation = source.generation()
    let pending: [SyncPendingTable]
    do {
      pending = try source.pending(rowLimit: maxSyncBatchRows)
    } catch let error as SyncProtocolError {
      return pause(.protocolFailure, detail: "\(error.table.wire).\(error.field)")
    } catch {
      return pause(.protocolFailure, detail: "encode")
    }

    switch SyncBatchBuilder.build(pending, rowCap: maxSyncBatchRows, byteCap: byteTarget) {
    case .empty:
      return .idle
    case .rowTooLarge(let table, let cursor, _):
      return pause(.rowTooLarge, detail: "\(table.wire)@\(cursor)")
    case .ready(let batch):
      return await deliver(batch, generation: generation)
    }
  }

  private func deliver(_ batch: SyncBuiltBatch, generation: Int64) async -> SyncPass {
    let response = await transport(batch.body)
    // A response that outlived its Account cannot touch the fresh database it would land in.
    if source.generation() != generation { return .idle }

    switch response {
    case .accepted(let body): return accept(batch, body: body)
    case .unauthorized: return pause(.authentication, detail: "401")
    case .invalid(let status, let error): return pause(.protocolFailure, detail: "\(status):\(error)")
    case .tooLarge: return shrink(batch)
    case .rateLimited(let retryAfterMs): return backOff(max(retryAfterMs, 0))
    case .transient:
      backoffMs = SyncPolicy.nextBackoffMs(backoffMs)
      return backOff(backoffMs)
    }
  }

  private func accept(_ batch: SyncBuiltBatch, body: String) -> SyncPass {
    guard let accepted = SyncAccepted.parse(body),
          SyncAccepted.matches(submitted: batch.counts, accepted: accepted)
    else {
      return pause(.protocolFailure, detail: "acceptedMismatch")
    }
    do {
      try source.commit(batch.advances)
    } catch {
      // The server took the rows but the checkpoint did not land. Backing off re-sends the identical
      // batch, which the server upserts idempotently — reporting success here would spin instead,
      // because the same rows are still pending.
      backoffMs = SyncPolicy.nextBackoffMs(backoffMs)
      return backOff(backoffMs)
    }
    backoffMs = 0
    retryAtMs = 0
    byteTarget = maxSyncBatchBytes
    return .sent(rowCount: batch.rowCount, morePending: source.pendingCount() > 0)
  }

  /// `413` narrows the byte target instead of dropping anything. Once the target can no longer hold
  /// even one row, that row is a permanent local protocol error — it is retained, not skipped.
  private func shrink(_ batch: SyncBuiltBatch) -> SyncPass {
    let table = batch.tables.first
    let detail = "\(table?.wire ?? "batch")@\(table.flatMap { batch.advances[$0] } ?? 0)"
    if batch.rowCount <= 1 { return pause(.rowTooLarge, detail: detail) }
    // Already as small as a batch gets: halving again would resend the same bytes forever, so the
    // disagreement about the wire limit is treated as what it is — permanent, with the rows kept.
    if byteTarget <= Self.minByteTarget { return pause(.rowTooLarge, detail: detail) }

    byteTarget = max(byteTarget / 2, Self.minByteTarget)
    return .retry
  }

  private func backOff(_ delayMs: Int64) -> SyncPass {
    retryAtMs = clock() + delayMs
    return .waiting(untilMs: retryAtMs)
  }

  private func pause(_ reason: SyncPauseReason, detail: String) -> SyncPass {
    pauseReason = reason
    source.recordPermanentFailure(reason, detail: detail)
    return .paused(reason)
  }
}
