import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/BmsSeriesRingTest.kt
final class BmsSeriesRingTests: XCTestCase {
  private let windowMs: Int64 = 5 * 60_000

  func testTrimsFramesOlderThanWindow() {
    let ring = BmsSeriesRing()
    ring.append(capturedAtMs: 1_000, cellVoltages: [3.9, 3.9], balancing: [false, false], windowMs: windowMs)
    ring.append(capturedAtMs: 2_000, cellVoltages: [4.0, 4.0], balancing: [false, false], windowMs: windowMs)
    ring.append(capturedAtMs: 2_000 + windowMs, cellVoltages: [4.1, 4.1], balancing: [false, false], windowMs: windowMs)

    let frames = ring.snapshot(windowMs: windowMs, nowMs: 2_000 + windowMs)

    XCTAssertEqual(frames.map(\.capturedAtMs), [2_000, 2_000 + windowMs])
  }

  func testSnapshotFiltersByWindowWithoutNewAppends() {
    let ring = BmsSeriesRing()
    ring.append(capturedAtMs: 1_000, cellVoltages: [3.9], balancing: [false], windowMs: windowMs)
    ring.append(capturedAtMs: 5_000, cellVoltages: [4.0], balancing: [false], windowMs: windowMs)

    let frames = ring.snapshot(windowMs: windowMs, nowMs: 4_000 + windowMs)

    XCTAssertEqual(frames.map(\.capturedAtMs), [5_000])
  }

  func testCellCountChangeResetsRing() {
    let ring = BmsSeriesRing()
    ring.append(capturedAtMs: 1_000, cellVoltages: [3.9, 3.9], balancing: [false, false], windowMs: windowMs)
    ring.append(capturedAtMs: 2_000, cellVoltages: [4.0, 4.0, 4.0], balancing: [false, false, false], windowMs: windowMs)

    XCTAssertEqual(ring.cellCount(), 3)
    XCTAssertEqual(ring.snapshot(windowMs: windowMs, nowMs: 2_000).map(\.capturedAtMs), [2_000])
  }

  func testRejectsFrameWithoutCells() {
    let ring = BmsSeriesRing()

    XCTAssertNil(ring.append(capturedAtMs: 1_000, cellVoltages: [], balancing: [], windowMs: windowMs))
    XCTAssertEqual(ring.cellCount(), 0)
  }

  func testEncodesColumnsWithSplitBalancingBitmask() {
    let ring = BmsSeriesRing()
    let voltages = (0..<32).map { 3.5 + Double($0) * 0.01 }
    let balancing = (0..<32).map { $0 == 0 || $0 == 31 }
    ring.append(capturedAtMs: 1_000, cellVoltages: voltages, balancing: balancing, windowMs: windowMs)

    let frames = ring.snapshot(windowMs: windowMs, nowMs: 1_000)
    let lanes = doubles(encodeBmsSeriesColumns(frames, cellCount: ring.cellCount()))

    XCTAssertEqual(lanes.count, BMS_SERIES_FIXED_LANES + 32)
    XCTAssertEqual(lanes[0], 1_000.0, accuracy: 0.0)
    XCTAssertEqual(lanes[1], 1.0, accuracy: 0.0)
    XCTAssertEqual(lanes[2], 2.0, accuracy: 0.0)
    XCTAssertEqual(lanes[BMS_SERIES_FIXED_LANES], 3.5, accuracy: 1e-9)
    XCTAssertEqual(lanes[BMS_SERIES_FIXED_LANES + 31], 3.81, accuracy: 1e-9)
  }

  private func doubles(_ data: Data) -> [Double] {
    stride(from: 0, to: data.count, by: MemoryLayout<Double>.size).map { offset in
      var bits: UInt64 = 0
      for i in 0..<MemoryLayout<Double>.size {
        bits |= UInt64(data[offset + i]) << UInt64(i * 8)
      }
      return Double(bitPattern: bits)
    }
  }
}
