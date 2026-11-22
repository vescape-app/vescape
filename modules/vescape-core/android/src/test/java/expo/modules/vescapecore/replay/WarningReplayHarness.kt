package expo.modules.vescapecore.replay

import expo.modules.vescapecore.protocol.BmsTelemetry
import expo.modules.vescapecore.warnings.BatteryConfigMismatchDetector
import expo.modules.vescapecore.warnings.CellSpreadDetector
import expo.modules.vescapecore.warnings.CellSpreadFinding

/**
 * @parity /modules/vescape-core/ios/replay/WarningReplayHarnessTests.swift
 */
internal object WarningReplayHarness {
  data class Result(
    val frameCount: Int,
    val cellSpreadFindings: List<CellSpreadFinding>,
    val mismatchFindings: List<String>,
    val cellSpreadSessionEndClean: Boolean,
    val mismatchSessionEndClean: Boolean,
  )

  fun run(
    jsonl: String,
    configuredSeries: Int?,
    transform: (BmsTelemetry, Long) -> BmsTelemetry = { bms, _ -> bms },
  ): Result {
    val cellSpread = CellSpreadDetector()
    val mismatch = BatteryConfigMismatchDetector()
    val cellSpreadFindings = mutableListOf<CellSpreadFinding>()
    val mismatchFindings = mutableListOf<String>()

    val frames = ReplayChunkDecoder.bmsFrames(jsonl)
    for (frame in frames) {
      val atMs = frame.capturedAt
      val bms = transform(frame, atMs)
      cellSpread.onFrame(bms.cellVoltages, bms.balancing, bms.vCharge, atMs)?.let(cellSpreadFindings::add)
      mismatch.onFrame(bms.cellVoltages.size, configuredSeries)?.let(mismatchFindings::add)
    }

    return Result(
      frameCount = frames.size,
      cellSpreadFindings = cellSpreadFindings,
      mismatchFindings = mismatchFindings,
      cellSpreadSessionEndClean = cellSpread.sessionEndClean(),
      mismatchSessionEndClean = mismatch.sessionEndClean(),
    )
  }
}
