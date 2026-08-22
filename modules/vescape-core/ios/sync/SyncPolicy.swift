import Foundation

/// How the uploader ran out of road. A paused engine is not woken by ordinary timer kicks.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncPolicy.kt `SyncPauseReason`
/// @parity /modules/vescape-core/src/index.ts `SyncPauseReason`
enum SyncPauseReason: String {
  /// No Device Token, or the server rejected the one we hold. Sign-in is the only way out.
  case authentication

  /// The server refused this batch on its contents, or answered `2xx` with something unreadable.
  case protocolFailure = "protocol"

  /// A single row cannot fit inside the wire byte cap. Retained, never skipped.
  case rowTooLarge

  var slug: String { rawValue }
}

/// The backup state the Rider is shown. Derived from the same `SyncState` the loop decides on, so
/// the status line can never disagree with what the uploader is actually doing.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncPolicy.kt `SyncActivity`
/// @parity /modules/vescape-core/src/index.ts `SyncActivity`
enum SyncActivity: String {
  /// The master switch is off. Nothing is scanned, sent, retried or reported.
  case disabled
  /// No credential: backup has never been turned on, or the Rider signed out.
  case signedOut
  case upToDate
  case syncing
  case waitingForWifi
  case offline
  /// Stopped on a permanent failure; `SyncStatus.pause` names which one.
  case paused

  var slug: String { rawValue }
}

/// What the loop should do next.
enum SyncDecision: Equatable {
  case sendNow
  /// Nothing to do until this moment; the loop re-decides then or when a kick lands.
  case wait(atMs: Int64)
  /// Stopped until the named condition changes. Timer and connectivity kicks do not bypass it.
  case paused(SyncPauseReason)
}

/// Everything the decision depends on, read once by the caller so the decision itself stays pure.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncPolicy.kt `SyncState`
struct SyncState {
  let nowMs: Int64
  /// Rows waiting across every table. Zero means idle, not finished.
  let pendingRows: Int
  /// A Board Session is producing samples — Idle Pause halts production without ending the session.
  let ridingSamples: Bool
  /// The Rider's master switch. Off means the uploader does nothing at all.
  let enabled: Bool
  let online: Bool
  /// Metered-connection setting; the uploader waits for Wi-Fi rather than failing.
  let wifiOnly: Bool
  let onWifi: Bool
  let credentialReady: Bool
  /// The App Status gate closed, like every other Online Capability.
  let onlineBlocked: Bool
  /// Set by a permanent failure; cleared only by sign-in or an Account reset.
  let pause: SyncPauseReason?
  /// Backoff or `Retry-After` deadline; before it, nothing is sent.
  let retryAtMs: Int64
}

/// The one place that turns state into "send, wait, or stopped".
///
/// Pure: no database, no clock, no network. The clock is `SyncState.nowMs` and the caller owns it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncPolicy.kt `SyncPolicy`
enum SyncPolicy {
  /// Cadence while a ride is producing samples: a crash loses at most this much.
  static let rideIntervalMs: Int64 = 30_000

  /// Cadence when nothing is pending. Cheap, because it is a no-op.
  static let idleIntervalMs: Int64 = 5 * 60_000

  static let backoffStartMs: Int64 = 30_000
  static let backoffMaxMs: Int64 = 15 * 60_000

  static func decide(_ state: SyncState) -> SyncDecision {
    // The master switch is checked before everything, including a pause: switched off is not a
    // broken uploader waiting to be resumed, it is one that is not running.
    if !state.enabled { return .wait(atMs: state.nowMs + idleIntervalMs) }
    if let pause = state.pause { return .paused(pause) }
    if !state.credentialReady { return .paused(.authentication) }

    let interval = state.ridingSamples ? rideIntervalMs : idleIntervalMs
    if state.pendingRows <= 0 { return .wait(atMs: state.nowMs + interval) }
    // Offline, metered, or gated: a pause in the loop, never a failure that moves backoff.
    if !state.online || state.onlineBlocked { return .wait(atMs: state.nowMs + interval) }
    if state.wifiOnly && !state.onWifi { return .wait(atMs: state.nowMs + interval) }
    if state.retryAtMs > state.nowMs { return .wait(atMs: state.retryAtMs) }
    return .sendNow
  }

  /// The same state, as the one line the Rider reads.
  ///
  /// Signed out wins over the pause it produces: a phone with no credential is not a broken backup,
  /// it is one that was never turned on. Everything below the pause is ordinary waiting.
  static func describe(_ state: SyncState) -> SyncActivity {
    if !state.enabled { return .disabled }
    if !state.credentialReady { return .signedOut }
    if state.pause != nil { return .paused }
    if state.pendingRows <= 0 { return .upToDate }
    if !state.online || state.onlineBlocked { return .offline }
    if state.wifiOnly && !state.onWifi { return .waitingForWifi }
    return .syncing
  }

  /// Next backoff step: doubling from `backoffStartMs`, capped, and reset to 0 on success.
  static func nextBackoffMs(_ previousMs: Int64) -> Int64 {
    previousMs <= 0 ? backoffStartMs : min(previousMs * 2, backoffMaxMs)
  }
}
