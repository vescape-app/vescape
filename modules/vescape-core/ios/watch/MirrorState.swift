import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `MirrorStatus`
enum MirrorStatus {
  case live
  case stale

  case waiting

  case disconnected
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `PhoneLink`
enum MirrorPhoneLink {
  case unknown

  case noPhone

  case phoneOnly

  case appReachable
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `LinkNotice`
enum MirrorLinkNotice {
  case connecting
  case noPhone
  case appMissing
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

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `MirrorStateReducer`
enum MirrorStateReducer {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `WATCH_FRAME_INTERVAL_MS`
  static let frameIntervalMs: Int64 = 250

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `MIRROR_DISCONNECTED_MIN_TIMEOUT_MS`
  static let minTimeoutMs: Int64 = 750
  static let maxTimeoutMs: Int64 = 30_000

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `MIRROR_CADENCE_WINDOW_GAPS`
  static let cadenceWindowGaps = 8

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

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt `linkNotice`
  static func linkNotice(status: MirrorStatus, link: MirrorPhoneLink) -> MirrorLinkNotice? {
    guard case .disconnected = status else { return nil }
    switch link {
    case .unknown: return .connecting
    case .noPhone: return .noPhone
    case .phoneOnly: return .appMissing
    case .appReachable: return nil
    }
  }
}
