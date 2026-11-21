import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/Ambient.kt `AmbientMode`
/// @platform-diff watchOS exposes only luminance reduction; the panel-capability flags and the
struct AmbientMode {
  var active: Bool = false

  static let off = AmbientMode()

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Ambient.kt `readout`
  func readout(_ color: Color) -> Color { active ? Palette.ambientText : color }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Ambient.kt `skeleton`
  func skeleton(_ color: Color) -> Color { active ? Palette.dimText : color }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Ambient.kt `glow`
  func glow(_ strength: Double) -> Double { active ? 0 : strength }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `laneColor`
  func lane(_ value: Double?, muted: Bool, _ color: Color) -> Color {
    (muted || value == nil) ? skeleton(Palette.dimText) : readout(color)
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `AMBIENT_REFRESH_INTERVAL_MS`
let AMBIENT_REFRESH_INTERVAL_SECONDS: TimeInterval = 10

let ACTIVE_REFRESH_INTERVAL_SECONDS: TimeInterval = Double(MirrorStateReducer.frameIntervalMs) / 1000
