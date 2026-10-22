import AVFoundation
import XCTest
@testable import VescapeCore

/// Teardown races around `AVAudioEngine`. `disconnectNodeOutput` on a node the engine no longer
/// owns raises an ObjC `NSException`, which Swift cannot catch — the process aborts. These tests
/// drive the paths where `release()` and pending `scheduleBuffer` completion handlers overlap, so
/// a regression shows up as a crashed test run rather than a Sentry report from a rider.
final class AlertAudioPlayerTests: XCTestCase {
  /// The SPM test target has no `VescapeCoreAssets.bundle`; read the effects packs from `shared/`.
  private var assetsDirectory: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .appendingPathComponent("../../../../shared/alerts/packs")
      .standardizedFileURL
  }

  private func makePlayer() -> AlertAudioPlayer {
    // Exercise real playback and teardown without sending the test tones to the speakers.
    AlertAudioPlayer(assetsDirectory: assetsDirectory, outputVolume: 0)
  }

  func testReleaseWhileOneShotAndSustainedPlaybackAreInFlight() {
    let player = makePlayer()
    player.updateGeiger(ruleId: "sustained", spec: "preset:sustained", rangeDepth: 1.0)
    player.updateGeiger(ruleId: "ticking", spec: "preset:tick", rangeDepth: 0.9)
    player.playSingle(spec: "alert(3):warning")
    player.preview(spec: "alert:critical")
    player.playRideEnd()
    player.boardConnected(playCue: true)

    // Let buffers actually start so completion handlers are pending when release lands.
    Thread.sleep(forTimeInterval: 0.15)
    player.release()
    // Give any handler queued behind release() a chance to run and re-enter detach.
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

  /// No explicit `release()`: `deinit` must tear down without deadlocking, including when the last
  /// reference drops while completion handlers are still running on the player's own queue.
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

  /// Collects outcomes from the player's queue; `wait` blocks until `count` arrived or times out.
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
