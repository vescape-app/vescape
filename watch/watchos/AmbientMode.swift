import SwiftUI

/// How the Mirror renders while the watch is in the Always On state.
///
/// Ambient is not a separate screen: the same layout draws, in the same places, so raising the
/// wrist is a state change on a live tree rather than a swap between two screens.  What changes is
/// which lanes are allowed to claim a value, and how the claim is drawn.
///
/// Every lane keeps its last reading, and colour is what says how much to trust it. Battery and
/// temperatures move slowly enough to still be exact at the reduced cadence and are drawn as
/// ``readout``s; speed and duty may be a tick behind and are drawn as ``skeleton``s — the same grey
/// the layout uses for a lane with nothing in it at all. Grey and a real number reads as "a moment
/// ago", which is both true and more use to a rider than an empty gauge. A frame that has stopped
/// arriving is the one case with nothing to say, and empties every lane to a dash.
///
/// watchOS gives one bit where Wear OS gives three: `isLuminanceReduced`. There is no low-bit
/// palette flag and no burn-in callback, because the system does its own pixel shifting — so the
/// Android `lowBit` and `burnInProtection` branches have no peer here and are not reproduced.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/Ambient.kt `AmbientMode`
/// @platform-diff watchOS exposes only luminance reduction; the panel-capability flags and the
///   burn-in pixel walk are the system's job, not the app's.
struct AmbientMode {
  var active: Bool = false

  /// The normal, screen-on case.
  static let off = AmbientMode()

  /// Colour for a reading ambient is willing to stand behind.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Ambient.kt `readout`
  func readout(_ color: Color) -> Color { active ? Palette.ambientText : color }

  /// Colour for a reading ambient is showing but will not vouch for as current.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Ambient.kt `skeleton`
  func skeleton(_ color: Color) -> Color { active ? Palette.dimText : color }

  /// Gradient wedge strength. Ambient draws flat strokes only: the fills are lit pixels, which is
  /// what both the battery and the burn-in budget are spent on.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Ambient.kt `glow`
  func glow(_ strength: Double) -> Double { active ? 0 : strength }

  /// A lane's colour. Ambient only tints as a ``readout`` what it actually has: an absent or frozen
  /// lane is a ``skeleton`` there, so a missing reading never renders brighter than a real one.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `laneColor`
  func lane(_ value: Double?, muted: Bool, _ color: Color) -> Color {
    (muted || value == nil) ? skeleton(Palette.dimText) : readout(color)
  }
}

/// Ambient repaint cadence. The phone drops to a reduced push while the wrist is in the Always On
/// state, so a slower tick here only ages the reading on screen without saving a radio wake.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `AMBIENT_REFRESH_INTERVAL_MS`
let AMBIENT_REFRESH_INTERVAL_SECONDS: TimeInterval = 10

/// Screen-on repaint cadence: the phone's default push interval, so the wrist ages a stopped stream
/// into `disconnected` about as fast as a frame would have arrived.
let ACTIVE_REFRESH_INTERVAL_SECONDS: TimeInterval = Double(MirrorStateReducer.frameIntervalMs) / 1000
