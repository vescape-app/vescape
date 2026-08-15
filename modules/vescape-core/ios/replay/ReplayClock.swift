import Foundation

/// The `SessionClock` a replay runs on: session time that advances at `warmupSpeed` × real time
/// until the recording leaves the warmup window, then at 1× for the rest of playback.
///
/// A replay may open with its live window already filled rather than spending real minutes earning
/// one. Dispatching the recording faster is not enough on its own: live series bucket each sample by
/// the timestamp it carries, across a window measured in minutes, so a six-minute warmup delivered
/// in twelve seconds would land as twelve seconds of samples — a sliver, not a filled window.
/// Running session time fast stamps those samples across the six minutes they actually cover, and the
/// window is genuinely full the moment the warmup ends.
///
/// The clock starts one warmup window in the past, so session time reaches "now" exactly as the
/// warmup finishes. Playback then continues at 1×, permanently trailing wall time by however long
/// the warmup took to play (`warmupMs / warmupSpeed`). That constant lag is what keeps the timeline
/// continuous — snapping it back to zero would tear a gap into every series at the boundary.
///
/// With `warmupMs` `0` — the default, and what the dev Replay UI uses — `speed` is never anything
/// but 1.0 and this clock reads exactly like wall time.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayClock.kt
internal final class ReplayClock: SessionClock {
  private let warmupMs: Int64
  private let warmupSpeed: Double
  /// Read from the BLE delegate queue, the main queue and the poll timer, so every read has to see
  /// one consistent anchor set rather than a half-updated one.
  private let lock = NSLock()
  private var currentSpeed: Double = 1.0
  private var anchorWallMs: Int64
  private var anchorSessionMs: Int64
  /// Session time of recorded offset `0`; fixed when playback actually begins.
  private var originSessionMs: Int64

  init(warmupMs: Int64 = 0, warmupSpeed: Double = 1.0) {
    self.warmupMs = warmupMs
    self.warmupSpeed = warmupSpeed
    let wallMs = Int64(Date().timeIntervalSince1970 * 1000)
    self.anchorWallMs = wallMs
    self.anchorSessionMs = wallMs - warmupMs
    self.originSessionMs = wallMs - warmupMs
  }

  var speed: Double {
    lock.lock()
    defer { lock.unlock() }
    return currentSpeed
  }

  func nowMs() -> Int64 {
    lock.lock()
    defer { lock.unlock() }
    return sessionAt(Int64(Date().timeIntervalSince1970 * 1000))
  }

  /// Session time never runs past the end of the warmup window while it is still running fast: the
  /// transport only notices the boundary on its next scheduling call, and without the clamp the
  /// clock would sail an arbitrary distance past it in the meantime — stamping samples beyond the
  /// window the warmup was asked to cover, by an amount that depends on when it happened to be read.
  /// Clamped, the handover lands on exactly `warmupMs` however late the check arrives.
  private func sessionAt(_ wallMs: Int64) -> Int64 {
    let elapsed = anchorSessionMs + Int64(Double(wallMs - anchorWallMs) * currentSpeed)
    return currentSpeed == 1.0 ? elapsed : min(elapsed, originSessionMs + warmupMs)
  }

  /// Re-anchor to the moment the first event is dispatched and hand the clock its warmup speed.
  ///
  /// Decoding a megabyte recording happens between construction and here, so the clock deliberately
  /// idles at 1× until this call — a clock already running at 30× would race through minutes of
  /// session time while the file was still being parsed. Because the pre-playback anchor is also
  /// `wall - warmupMs` at 1×, re-anchoring here cannot move session time; it only changes how fast
  /// it runs from now on.
  func startPlayback(wallMs: Int64) {
    lock.lock()
    defer { lock.unlock() }
    anchorWallMs = wallMs
    anchorSessionMs = wallMs - warmupMs
    originSessionMs = anchorSessionMs
    currentSpeed = warmupMs > 0 ? warmupSpeed : 1.0
  }

  /// Wall milliseconds to wait before the recording reaches `recordedT`.
  ///
  /// The drop to 1× happens once session time has *reached* the end of the warmup window, not when
  /// an event past it is first scheduled: the event that lands on the boundary is still part of the
  /// warmup and has to be paced at warmup speed, or the clock would spend a full real warmup window
  /// sleeping its way to it. Session time is continuous across the change — the new anchor is the
  /// session time the old speed had just produced.
  func delayUntilRecorded(_ recordedT: Int64) -> Int64 {
    lock.lock()
    defer { lock.unlock() }
    let wallMs = Int64(Date().timeIntervalSince1970 * 1000)
    if currentSpeed != 1.0, sessionAt(wallMs) >= originSessionMs + warmupMs {
      anchorSessionMs = sessionAt(wallMs)
      anchorWallMs = wallMs
      currentSpeed = 1.0
    }
    let remainingSessionMs = originSessionMs + recordedT - sessionAt(wallMs)
    return remainingSessionMs <= 0 ? 0 : Int64(Double(remainingSessionMs) / currentSpeed)
  }
}
