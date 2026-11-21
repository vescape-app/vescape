import AVFoundation
import XCTest
@testable import VescapeCore

final class AlertAudioPlayerTests: XCTestCase {
  private var assetsDirectory: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .appendingPathComponent("../../../../shared/alerts/packs")
      .standardizedFileURL
  }

  private func makePlayer() -> AlertAudioPlayer {
    AlertAudioPlayer(assetsDirectory: assetsDirectory, outputVolume: 0)
  }

  func testReleaseWhileOneShotAndSustainedPlaybackAreInFlight() {
    let player = makePlayer()
    player.updateGeiger(ruleId: "sustained", spec: "preset:sustained", rangeDepth: 1.0)
    player.updateGeiger(ruleId: "ticking", spec: "preset:tick", rangeDepth: 0.9)
    player.playSingle(spec: "alert(3):warning")
    player.preview(spec: "alert:critical")
    player.boardConnected(playCue: true)

    Thread.sleep(forTimeInterval: 0.15)
    player.release()
    Thread.sleep(forTimeInterval: 0.3)
  }

  func testReleaseIsIdempotentAndPlaybackAfterReleaseIsInert() {
    let player = makePlayer()
    player.playSingle(spec: "preset:beep")
    player.release()
    player.release()
    player.playSingle(spec: "preset:beep")
    player.preview(spec: "preset:tick")
    player.updateGeiger(ruleId: "r", spec: "preset:tick", rangeDepth: 0.5)
    player.stopAllGeiger()
    Thread.sleep(forTimeInterval: 0.1)
  }

  func testDeallocWithoutExplicitReleaseWhilePlaybackIsInFlight() {
    for _ in 0..<5 {
      autoreleasepool {
        let player = makePlayer()
        player.updateGeiger(ruleId: "sustained", spec: "preset:sustained", rangeDepth: 1.0)
        player.playSingle(spec: "alert(2):critical")
      }
      Thread.sleep(forTimeInterval: 0.05)
    }
  }

  func testConcurrentPlaybackFromManyThreadsThenRelease() {
    let player = makePlayer()
    let group = DispatchGroup()
    for index in 0..<8 {
      DispatchQueue.global(qos: .userInitiated).async(group: group) {
        for _ in 0..<10 {
          player.preview(spec: index.isMultiple(of: 2) ? "preset:beep" : "preset:tick")
          player.updateGeiger(ruleId: "rule-\(index)", spec: "preset:tick", rangeDepth: 0.95)
        }
      }
    }
    _ = group.wait(timeout: .now() + 5)
    player.release()
    Thread.sleep(forTimeInterval: 0.3)
  }

  private final class Outcomes {
    private let lock = NSLock()
    private var values: [String: [PlaybackOutcome]] = [:]
    func record(_ name: String) -> PlaybackDone {
      { outcome in
        self.lock.lock()
        self.values[name, default: []].append(outcome)
        self.lock.unlock()
      }
    }
    func of(_ name: String) -> [PlaybackOutcome] {
      lock.lock()
      defer { lock.unlock() }
      return values[name] ?? []
    }
  }

  func testOneShotReportsCompletedOnce() {
    let player = makePlayer()
    let outcomes = Outcomes()
    player.playSingle(spec: "alert:warning", onDone: outcomes.record("single"))
    player.playAppCue("on", onDone: outcomes.record("cue"))
    player.playAppCue("not-a-cue", onDone: outcomes.record("unknown"))
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline, outcomes.of("single").isEmpty || outcomes.of("cue").isEmpty {
      Thread.sleep(forTimeInterval: 0.05)
    }
    XCTAssertEqual(outcomes.of("single"), [.completed])
    XCTAssertEqual(outcomes.of("cue"), [.completed])
    XCTAssertEqual(outcomes.of("unknown"), [.failed])
    player.release()
    Thread.sleep(forTimeInterval: 0.1)
    XCTAssertEqual(outcomes.of("single"), [.completed])
  }

  func testPreemptedSpeechReportsCancelledOnce() {
    let player = makePlayer()
    let outcomes = Outcomes()
    player.speakAfterSeverity(.warning, text: "first", onDone: outcomes.record("first"))
    player.speakAfterSeverity(.critical, text: "second", onDone: outcomes.record("second"))
    Thread.sleep(forTimeInterval: 0.2)
    XCTAssertEqual(outcomes.of("first"), [.cancelled])
    player.release()
    Thread.sleep(forTimeInterval: 0.2)
    XCTAssertEqual(outcomes.of("first"), [.cancelled])
    XCTAssertEqual(outcomes.of("second"), [.cancelled])
  }

  func testCompletionDeliversTheFirstOutcomeOnly() {
    var outcomes: [PlaybackOutcome] = []
    let tracker = PlaybackTracker(deliver: { $0() })
    let first = tracker.start { outcomes.append($0) }
    tracker.claimSpeech(first)
    let second = tracker.start { _ in }
    tracker.claimSpeech(second)
    XCTAssertFalse(first.finish(.completed))
    tracker.cancelAll()
    XCTAssertEqual(outcomes, [.cancelled])
    XCTAssertTrue(second.isDone)
  }
}
