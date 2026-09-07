import Foundation

/// Telemetry-scoped Board Warning detector for a smart-BMS cell count that disagrees with the board's
/// configured battery series count. Pure evaluation logic per the pure-native-logic ADR: a stateful
/// tracker fed each ~4Hz BMS frame's cell count plus the configured series count; session wiring
/// (registry reporting, lifecycle) stays in the session controller.
///
/// The BMS cell count must be stable — the same count across `stableFrames` consecutive frames —
/// before it is compared. The BMS series payload's `cellNum` can wobble on a reconnect or a firmware
/// quirk (`BmsSeriesRing` resets its columnar layout on any width change), so a single odd frame must
/// never fire; the run resets whenever the count changes. Once stable, the count is compared against
/// the configured series count that the SoC estimator and the per-cell pushback bounds also read: a
/// difference fires one warn-severity warning carrying both counts, matching counts fire nothing and
/// leave a session-end clean evaluation to auto-clear any stored warning.
///
/// A missing configured series count is not a clean evaluation — with nothing to compare against the
/// detector reports nothing and leaves any stored warning untouched (guarded via `sessionEndClean`).
/// A session with no BMS data likewise reaches no stable count and reports nothing.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BatteryConfigMismatchDetector.kt
final class BatteryConfigMismatchDetector {
  /// BMS cell count must repeat across this many consecutive frames before it is compared.
  static let stableFrames = 3

  private let stableFrames: Int

  private var runValue = 0
  private var runLen = 0
  private var evaluated = false
  private var fired = false
  private var reportedCount = -1
  private var reportedSeries = -1

  init(stableFrames: Int = BatteryConfigMismatchDetector.stableFrames) {
    self.stableFrames = stableFrames
  }

  /// Reset all tracking for a fresh Board Session.
  func reset() {
    runValue = 0
    runLen = 0
    evaluated = false
    fired = false
    reportedCount = -1
    reportedSeries = -1
  }

  /// Feed one smart-BMS frame's cell count and the currently configured series count. Returns the
  /// warning payload to report, or nil when nothing should be reported this frame (no cells, the
  /// count is not yet stable, no configured series to compare against, the counts match, or this
  /// exact mismatch pair was already reported).
  func onFrame(bmsCellCount: Int, configuredSeries: Int?) throws -> String? {
    if bmsCellCount <= 0 { return nil }
    if bmsCellCount == runValue {
      runLen += 1
    } else {
      runValue = bmsCellCount
      runLen = 1
    }
    // A single odd frame (or the first frame of a new stable count) must not fire.
    if runLen < stableFrames { return nil }
    // No configured series to compare against is not a clean evaluation — report nothing and leave
    // any stored warning untouched (evaluated stays false so sessionEndClean does not clear it).
    guard let configuredSeries, configuredSeries > 0 else { return nil }
    evaluated = true
    if bmsCellCount == configuredSeries { return nil }
    // Dedupe on the full pair — a live config change (BMS count unchanged, series count moved) is a
    // different mismatch and must re-report so the stored payload never goes stale.
    if fired, reportedCount == bmsCellCount, reportedSeries == configuredSeries { return nil }
    fired = true
    reportedCount = bmsCellCount
    reportedSeries = configuredSeries
    return try payloadJson(bmsCellCount: bmsCellCount, configuredSeries: configuredSeries)
  }

  /// At session end: report a clean evaluation only when a stable BMS count was compared against a
  /// configured series count and no mismatch fired. No BMS data or no configured series leaves
  /// `evaluated` false, so a previously stored warning is left untouched.
  func sessionEndClean() -> Bool { evaluated && !fired }

  private func payloadJson(bmsCellCount: Int, configuredSeries: Int) throws -> String {
    try BoardWarningPayload.json([
      "bmsCellCount": bmsCellCount,
      "configuredSeries": configuredSeries,
    ])
  }
}
