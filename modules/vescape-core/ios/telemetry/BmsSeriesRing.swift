import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `BMS_SERIES_FIXED_LANES`
/// @parity /modules/vescape-core/src/bmsSeries.ts `BMS_SERIES_FIXED_LANES`
internal let BMS_SERIES_FIXED_LANES = 3

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `BMS_SERIES_BALANCE_LANE_BITS`
/// @parity /modules/vescape-core/src/bmsSeries.ts `BMS_SERIES_BALANCE_LANE_BITS`
internal let BMS_SERIES_BALANCE_LANE_BITS = 30

internal struct BmsSeriesFrame {
  let capturedAtMs: Int64
  let cellVoltages: [Double]
  let balancing: [Bool]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt
internal final class BmsSeriesRing: @unchecked Sendable {
  private let lock = NSLock()
  private var frames: [BmsSeriesFrame] = []
  private var cellCountValue = 0

  @discardableResult
  func append(
    capturedAtMs: Int64,
    cellVoltages: [Double],
    balancing: [Bool],
    windowMs: Int64
  ) -> BmsSeriesFrame? {
    guard !cellVoltages.isEmpty else { return nil }
    lock.lock()
    defer { lock.unlock() }
    if cellVoltages.count != cellCountValue {
      frames.removeAll(keepingCapacity: true)
      cellCountValue = cellVoltages.count
    }
    let frame = BmsSeriesFrame(
      capturedAtMs: capturedAtMs,
      cellVoltages: cellVoltages,
      balancing: (0..<cellCountValue).map { $0 < balancing.count ? balancing[$0] : false }
    )
    frames.append(frame)
    let oldest = capturedAtMs - windowMs
    if let firstKeep = frames.firstIndex(where: { $0.capturedAtMs >= oldest }), firstKeep > 0 {
      frames.removeFirst(firstKeep)
    }
    return frame
  }

  func clear() {
    lock.lock()
    frames.removeAll(keepingCapacity: true)
    cellCountValue = 0
    lock.unlock()
  }

  func snapshot(windowMs: Int64, nowMs: Int64) -> [BmsSeriesFrame] {
    lock.lock()
    defer { lock.unlock() }
    let oldest = nowMs - windowMs
    return frames.filter { $0.capturedAtMs >= oldest }
  }

  func cellCount() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return cellCountValue
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `encodeBmsSeriesColumns`
/// @parity /modules/vescape-core/src/index.ts `decodeBmsSeriesFrames`
internal func encodeBmsSeriesColumns(_ frames: [BmsSeriesFrame], cellCount: Int) -> Data {
  let laneCount = BMS_SERIES_FIXED_LANES + cellCount
  var data = Data(capacity: frames.count * laneCount * MemoryLayout<Double>.size)
  for frame in frames {
    var bitsLo: Int64 = 0
    var bitsHi: Int64 = 0
    for (i, balancing) in frame.balancing.enumerated() where balancing {
      if i < BMS_SERIES_BALANCE_LANE_BITS {
        bitsLo |= 1 << i
      } else {
        bitsHi |= 1 << (i - BMS_SERIES_BALANCE_LANE_BITS)
      }
    }
    appendDouble(&data, Double(frame.capturedAtMs))
    appendDouble(&data, Double(bitsLo))
    appendDouble(&data, Double(bitsHi))
    for i in 0..<cellCount {
      appendDouble(&data, i < frame.cellVoltages.count ? frame.cellVoltages[i] : Double.nan)
    }
  }
  return data
}
