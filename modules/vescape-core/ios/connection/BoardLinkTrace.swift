import Foundation

/// Board Link persistence trace (ADR 0035, #409). Linking and re-linking end in a live connection,
/// so the Event Log has to show the moment the Board Link actually became durable — the connect that
/// follows reads it back from the database, and a connect against a link that never landed is the
/// exact failure this ordering exists to prevent.
///
/// Every Board write funnels through the same native upsert (renames, battery edits, warning
/// dismissals), so only writes that *change* the Board Link are traced. Everything else is noise.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardLinkTrace.kt
internal enum BoardLinkTrace {
  /// True when this Board write is the moment a Board Link becomes durable: a link is present and
  /// differs from the stored one. A re-saved identical link, or a Board with no link at all, is
  /// not a linking event.
  static func isLinkPersist(previousBleId: String?, nextBleId: String?) -> Bool {
    guard let nextBleId else { return false }
    return nextBleId != previousBleId
  }

  /// The BLE id inside a Board record's `link` value, or `nil` for an offline Board.
  static func bleId(ofLink link: Any?) -> String? {
    guard let link = link as? [String: Any] else { return nil }
    guard let bleId = link["bleId"] as? String, !bleId.isEmpty else { return nil }
    return bleId
  }

  static func persisted(boardId: String, bleId: String) {
    let workflow = start(boardId: boardId)
    workflow.event(
      ConnectionTraceEvent.boardLinkPersisted,
      fields: [
        ConnectionTraceField.boardId: boardId,
        ConnectionTraceField.bleId: bleId,
      ]
    )
    workflow.finish(decision: ConnectionTraceDecision.completed, reason: ConnectionTraceReason.matched)
  }

  static func failed(boardId: String, message: String?) {
    let workflow = start(boardId: boardId)
    workflow.event(
      ConnectionTraceEvent.boardLinkFailed,
      fields: [
        ConnectionTraceField.boardId: boardId,
        ConnectionTraceField.platformErrorCode: message,
      ]
    )
    workflow.finish(decision: ConnectionTraceDecision.failed, reason: ConnectionTraceReason.platformError)
  }

  private static func start(boardId: String) -> ConnectionWorkflow {
    ConnectionTrace.start(
      origin: ConnectionTraceOrigin.boardLinked,
      owner: ConnectionTraceOwner.none,
      fields: [ConnectionTraceField.boardId: boardId]
    )
  }
}
