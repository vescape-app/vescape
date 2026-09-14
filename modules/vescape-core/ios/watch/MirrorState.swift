import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `MirrorStatus`
enum MirrorStatus {
  case live
  case stale

  /// Legacy phone frame; retained for compatibility with older phone builds. No iOS phone sets the
  /// flag, so this is unreachable on watchOS today — it exists because the reducer is the contract,
  /// and a contract that silently drops a flag the wire format defines is not one.
  case waiting

  /// No fresh frames at all — see `MirrorPhoneLink` for why.
  case disconnected
}

/// Watch-local view of the phone link. Only meaningful while no frames arrive — it names the reason
/// for the wait. Android derives it from `NodeClient` + `CapabilityClient`; watchOS reads the same
/// three facts off `WCSession` (paired, companion installed, reachable).
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `PhoneLink`
enum MirrorPhoneLink {
  case unknown

  /// No paired phone at all: the watch is not talking to an iPhone.
  case noPhone

  /// A phone is paired but the Vescape companion is absent — app missing or too old.
  case phoneOnly

  /// The Vescape phone app is installed and reachable; it just isn't pushing.
  case appReachable
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `MirrorState`
struct MirrorState: Equatable {
  let status: MirrorStatus
  let frame: WatchFrame?

  init(status: MirrorStatus, frame: WatchFrame?) {
    self.status = status
    self.frame = frame
  }
}

/// Pure frame-plus-clock -> Mirror State reduction. The wrist ages a stopped stream into
/// `disconnected` off its own clock, so a phone that stops pushing without saying so still shows as
/// offline rather than freezing on a plausible-looking number.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `MirrorStateReducer`
enum MirrorStateReducer {
  /// Cadence assumed until two frames have been seen; matches the phone's default push interval.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `WATCH_FRAME_INTERVAL_MS`
  static let frameIntervalMs: Int64 = 250

  /// Three missed frames means disconnected. The phone's push cadence is a rider setting, so the
  /// window is measured from the frames that actually arrive rather than assumed — a hardcoded
  /// window pins the mirror to `disconnected` on every cadence above the default. Clamped so
  /// neither a burst nor a long stall distorts it.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `MIRROR_DISCONNECTED_MIN_TIMEOUT_MS`
  static let minTimeoutMs: Int64 = 750
  static let maxTimeoutMs: Int64 = 30_000

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `mirrorDisconnectedTimeoutMs`
  static func disconnectedTimeoutMs(frameGapMs: Int64?) -> Int64 {
    min(max((frameGapMs ?? frameIntervalMs) * 3, minTimeoutMs), maxTimeoutMs)
  }

  static func reduce(
    frame: WatchFrame?,
    lastFrameAtMs: Int64?,
    nowMs: Int64,
    timeoutMs: Int64 = disconnectedTimeoutMs(frameGapMs: nil)
  ) -> MirrorState {
    guard let frame, let lastFrameAtMs, nowMs - lastFrameAtMs <= timeoutMs else {
      return MirrorState(status: .disconnected, frame: nil)
    }

    if frame.waiting {
      // The lanes carry no data in a waiting frame and must not be rendered: emptied here rather
      // than trusted to every readout to check the flag.
      var blanked = frame
      blanked.speed = nil
      blanked.duty = nil
      blanked.battery = nil
      blanked.motorTemp = nil
      blanked.ctrlTemp = nil
      return MirrorState(status: .waiting, frame: blanked)
    }

    return MirrorState(status: frame.stale ? .stale : .live, frame: frame)
  }
}
