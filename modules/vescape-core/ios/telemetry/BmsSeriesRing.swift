import Foundation

/// Fixed lanes preceding the per-cell voltage lanes in the columnar BMS series payload.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `BMS_SERIES_FIXED_LANES`
/// @parity /modules/vescape-core/src/bmsSeries.ts `BMS_SERIES_FIXED_LANES`
internal let BMS_SERIES_FIXED_LANES = 3

/// Bits per balancing lane. Cell counts go up to 60 and a Float64 only holds 53 exact integer
/// bits, so the balancing bitmask is split across two lanes of 30 bits each.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `BMS_SERIES_BALANCE_LANE_BITS`
/// @parity /modules/vescape-core/src/bmsSeries.ts `BMS_SERIES_BALANCE_LANE_BITS`
internal let BMS_SERIES_BALANCE_LANE_BITS = 30

internal struct BmsSeriesFrame {
  let capturedAtMs: Int64
  let cellVoltages: [Double]
  let balancing: [Bool]
}

/// Live BMS Series retention: an in-memory per-cell-group voltage/balancing ring covering the
/// recent live-telemetry window (`liveHistoryLimit`). Fed from the existing ~4Hz `onBms` frames —
/// retention runs for the whole Board Session regardless of what JS is showing; only the bridge
/// push is gated by battery-detail focus. Never persisted; cleared with the Board Session.
///
/// Appends arrive on the BLE callback queue while snapshots are taken on the focus intent from
/// the JS thread, so all access holds `lock`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt
internal final class BmsSeriesRing {
  private let lock = NSLock()
  private var frames: [BmsSeriesFrame] = []
  private var cellCountValue = 0

  /// Appends one BMS frame and prunes to `windowMs`. A cell-count change (different BMS on
  /// reconnect hardware, firmware quirk) resets the ring — mixed-width frames can't share one
  /// columnar layout. Returns the stored frame, or nil when the frame carries no cells.
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

  /// Windowed copy for the focus-time snapshot push.
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

/// Columnar binary encoding of BMS series frames for the bridge push (ADR-0018): each frame is
/// `BMS_SERIES_FIXED_LANES + cellCount` little-endian Float64 lanes, row-major —
/// `[capturedAtMs, balanceBitsLo, balanceBitsHi, v0..v{cellCount-1}]`. Decoded by
/// `decodeBmsSeriesFrames` in `modules/vescape-core/src/index.ts`; lane order is shared by convention.
///
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
