import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/LiveSeriesDownsamplerTest.kt
final class LiveSeriesDownsamplerTests: XCTestCase {
  private struct Row { let ts: Int64; let v: Double? }

  private func run(_ rows: [Row], buckets: Int, windowMs: Int64) -> [Double] {
    LiveSeriesDownsampler.downsampleMinMax(rows, bucketCount: buckets, windowMs: windowMs,
      timestamp: { $0.ts }, value: { $0.v })
  }

  private func values(_ out: [Double]) -> [Double] {
    stride(from: 1, to: out.count, by: 2).map { out[$0] }
  }

  private func points(_ out: [Double]) -> [(Int64, Double)] {
    stride(from: 0, to: out.count, by: 2).map { (Int64(out[$0]), out[$0 + 1]) }
  }

  func testEmptyInputYieldsEmpty() {
    XCTAssertEqual(run([], buckets: 8, windowMs: 40).count, 0)
  }

  func testNonPositiveWindowYieldsEmpty() {
    XCTAssertEqual(run([Row(ts: 0, v: 1.0)], buckets: 8, windowMs: 0).count, 0)
  }

  func testPreservesBucketPeaksAndTroughs() {
    var rows = (0..<40).map { Row(ts: Int64($0), v: 0.0) }
    rows[10] = Row(ts: 10, v: 100.0)
    rows[25] = Row(ts: 25, v: -50.0)

    let out = run(rows, buckets: 4, windowMs: 40)
    let vals = values(out)

    XCTAssertTrue(out.count / 2 < rows.count, "decimated below input")
    XCTAssertEqual(vals.max()!, 100.0, accuracy: 0.0)
    XCTAssertEqual(vals.min()!, -50.0, accuracy: 0.0)
  }

  func testEmitsPointsInChronologicalOrder() {
    let ramp = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1].enumerated().map { Row(ts: Int64($0.offset), v: Double($0.element)) }
    let out = run(ramp, buckets: 2, windowMs: 10)
    for i in stride(from: 2, to: out.count, by: 2) {
      XCTAssertTrue(out[i] >= out[i - 2], "timestamps non-decreasing")
    }
  }

  func testSkipsNullAndNonFinite() {
    let rows = (0..<30).map { i -> Row in
      if i == 5 { return Row(ts: Int64(i), v: nil) }
      if i == 6 { return Row(ts: Int64(i), v: Double.nan) }
      return Row(ts: Int64(i), v: Double(i))
    }
    let vals = values(run(rows, buckets: 3, windowMs: 30))
    XCTAssertFalse(vals.contains { $0.isNaN })
    XCTAssertEqual(vals.max()!, 29.0, accuracy: 0.0)
  }

  func testSingleTimestampCollapsesToMinAndMax() {
    let rows = [Row(ts: 1000, v: 3.0), Row(ts: 1000, v: 9.0), Row(ts: 1000, v: 1.0)]
    let vals = values(run(rows, buckets: 8, windowMs: 8000))
    XCTAssertEqual(vals.min()!, 1.0, accuracy: 0.0)
    XCTAssertEqual(vals.max()!, 9.0, accuracy: 0.0)
  }

  func testSharedBucketsIdenticalAcrossSlidingWindows() {
    let buckets = 5
    let windowMs: Int64 = 50
    let older = (0...49).map { Row(ts: Int64($0), v: Double($0 % 7)) }
    let newer = (20...69).map { Row(ts: Int64($0), v: Double($0 % 7)) }

    let a = points(run(older, buckets: buckets, windowMs: windowMs)).filter { $0.0 >= 30 && $0.0 <= 39 }
    let b = points(run(newer, buckets: buckets, windowMs: windowMs)).filter { $0.0 >= 30 && $0.0 <= 39 }

    XCTAssertEqual(a.map { $0.0 }, b.map { $0.0 })
    XCTAssertEqual(a.map { $0.1 }, b.map { $0.1 })
    XCTAssertFalse(a.isEmpty, "bucket 30..39 emitted")
  }
}
