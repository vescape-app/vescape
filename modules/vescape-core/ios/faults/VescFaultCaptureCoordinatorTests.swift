import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinatorTest.kt
final class VescFaultCaptureCoordinatorTests: XCTestCase {
  private final class FakeStore: VescFaultCaptureStoring {
    var captures: [String: VescFaultCapture] = [:]
    var samples: [String: [VescFaultCaptureSample]] = [:]

    func upsertCapture(_ capture: VescFaultCapture) { captures[capture.occurrenceId] = capture }
    func appendSamples(_ occurrenceId: String, _ samples: [VescFaultCaptureSample]) {
      self.samples[occurrenceId] = samples
    }
    func getCapture(_ occurrenceId: String) -> VescFaultCapture? { captures[occurrenceId] }
    func getSamples(_ occurrenceId: String) -> [VescFaultCaptureSample] { samples[occurrenceId] ?? [] }
  }

  private let open: Int64 = 1_700_000_000_000

  private func tick(_ atMs: Int64) -> [String: Any?] { ["lastPacketAt": atMs, "speed": 20.0] }

  func testCapturesOnlyTheFiveSecondsBeforeDetection() {
    let store = FakeStore()
    let coordinator = VescFaultCaptureCoordinator(store: store, writeQueue: nil)
    coordinator.recentWindow = {
      [self.tick(self.open - 5_001), self.tick(self.open - 5_000), self.tick(self.open), self.tick(self.open + 1)]
    }

    coordinator.capturePast(occurrenceId: "occ", boardId: "board", openedAtMs: open)

    XCTAssertEqual(store.samples["occ"]?.map(\.capturedAtMs), [open - 5_000, open])
    XCTAssertEqual(store.captures["occ"]?.sampleCount, 2)
  }

  func testMissingRecentTelemetryCreatesAnEmptyCompletedCapture() {
    let store = FakeStore()
    VescFaultCaptureCoordinator(store: store, writeQueue: nil)
      .capturePast(occurrenceId: "occ", boardId: "board", openedAtMs: open)

    XCTAssertEqual(store.captures["occ"]?.sampleCount, 0)
  }

  func testCollectionOffCreatesNothing() {
    let store = FakeStore()
    let coordinator = VescFaultCaptureCoordinator(store: store, writeQueue: nil)
    coordinator.setCollectionEnabled(false)
    coordinator.capturePast(occurrenceId: "occ", boardId: "board", openedAtMs: open)

    XCTAssertTrue(store.captures.isEmpty)
  }
}
