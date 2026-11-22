import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BatteryConfigMismatchDetector.kt
final class BatteryConfigMismatchDetector {
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

  func reset() {
    runValue = 0
    runLen = 0
    evaluated = false
    fired = false
    reportedCount = -1
    reportedSeries = -1
  }

  func onFrame(bmsCellCount: Int, configuredSeries: Int?) throws -> String? {
    if bmsCellCount <= 0 { return nil }
    if bmsCellCount == runValue {
      runLen += 1
    } else {
      runValue = bmsCellCount
      runLen = 1
    }
    if runLen < stableFrames { return nil }
    guard let configuredSeries, configuredSeries > 0 else { return nil }
    evaluated = true
    if bmsCellCount == configuredSeries { return nil }
    if fired, reportedCount == bmsCellCount, reportedSeries == configuredSeries { return nil }
    fired = true
    reportedCount = bmsCellCount
    reportedSeries = configuredSeries
    return try payloadJson(bmsCellCount: bmsCellCount, configuredSeries: configuredSeries)
  }

  func sessionEndClean() -> Bool { evaluated && !fired }

  private func payloadJson(bmsCellCount: Int, configuredSeries: Int) throws -> String {
    try BoardWarningPayload.json([
      "bmsCellCount": bmsCellCount,
      "configuredSeries": configuredSeries,
    ])
  }
}
