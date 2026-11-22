package expo.modules.vescapecore.warnings

/**
 * @parity /modules/vescape-core/ios/warnings/BatteryConfigMismatchDetector.swift
 */
class BatteryConfigMismatchDetector(
  private val stableFrames: Int = STABLE_FRAMES,
) {
  private var runValue = 0
  private var runLen = 0
  private var evaluated = false
  private var fired = false
  private var reportedCount = -1
  private var reportedSeries = -1

  fun reset() {
    runValue = 0
    runLen = 0
    evaluated = false
    fired = false
    reportedCount = -1
    reportedSeries = -1
  }

  fun onFrame(bmsCellCount: Int, configuredSeries: Int?): String? {
    if (bmsCellCount <= 0) return null
    if (bmsCellCount == runValue) runLen += 1 else { runValue = bmsCellCount; runLen = 1 }
    if (runLen < stableFrames) return null
    if (configuredSeries == null || configuredSeries <= 0) return null
    evaluated = true
    if (bmsCellCount == configuredSeries) return null
    if (fired && reportedCount == bmsCellCount && reportedSeries == configuredSeries) return null
    fired = true
    reportedCount = bmsCellCount
    reportedSeries = configuredSeries
    return payloadJson(bmsCellCount, configuredSeries)
  }

  fun sessionEndClean(): Boolean = evaluated && !fired

  private fun payloadJson(bmsCellCount: Int, configuredSeries: Int): String =
    boardWarningPayload {
      put("bmsCellCount", bmsCellCount)
      put("configuredSeries", configuredSeries)
    }

  companion object {
    const val STABLE_FRAMES = 3
  }
}
