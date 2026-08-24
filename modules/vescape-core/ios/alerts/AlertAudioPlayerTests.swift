import AVFoundation
import XCTest
@testable import VescapeCore

/// Teardown races around `AVAudioEngine`. `disconnectNodeOutput` on a node the engine no longer
/// owns raises an ObjC `NSException`, which Swift cannot catch — the process aborts. These tests
/// drive the paths where `release()` and pending `scheduleBuffer` completion handlers overlap, so
/// a regression shows up as a crashed test run rather than a Sentry report from a rider.
final class AlertAudioPlayerTests: XCTestCase {
  /// The SPM test target has no `VescapeCoreAssets.bundle`; the wavs live next to the source.
  private var assetsDirectory: URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  }

  private func makePlayer() -> AlertAudioPlayer {
    AlertAudioPlayer(assetsDirectory: assetsDirectory)
  }

  func testReleaseWhileOneShotAndSustainedPlaybackAreInFlight() {
    let player = makePlayer()
    player.updateGeiger(ruleId: "sustained", soundType: "preset:sustained", rangeDepth: 1.0)
    player.updateGeiger(ruleId: "ticking", soundType: "preset:tick", rangeDepth: 0.9)
    player.playSingle(soundType: "preset:beep", beepCount: 3)
    player.preview(soundType: "preset:urgent")
    player.playConnect()

    // Let buffers actually start so completion handlers are pending when release lands.
    Thread.sleep(forTimeInterval: 0.15)
    player.release()
    // Give any handler queued behind release() a chance to run and re-enter detach.
    Thread.sleep(forTimeInterval: 0.3)
  }

  func testReleaseIsIdempotentAndPlaybackAfterReleaseIsInert() {
    let player = makePlayer()
    player.playSingle(soundType: "preset:beep")
    player.release()
    player.release()
    player.playSingle(soundType: "preset:beep")
    player.preview(soundType: "preset:tick")
    player.updateGeiger(ruleId: "r", soundType: "preset:tick", rangeDepth: 0.5)
    player.stopAllGeiger()
    Thread.sleep(forTimeInterval: 0.1)
  }

  /// No explicit `release()`: `deinit` must tear down without deadlocking, including when the last
  /// reference drops while completion handlers are still running on the player's own queue.
  func testDeallocWithoutExplicitReleaseWhilePlaybackIsInFlight() {
    for _ in 0..<5 {
      autoreleasepool {
        let player = makePlayer()
        player.updateGeiger(ruleId: "sustained", soundType: "preset:sustained", rangeDepth: 1.0)
        player.playSingle(soundType: "preset:beep", beepCount: 2)
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
          player.preview(soundType: index.isMultiple(of: 2) ? "preset:beep" : "preset:tick")
          player.updateGeiger(ruleId: "rule-\(index)", soundType: "preset:tick", rangeDepth: 0.95)
        }
      }
    }
    _ = group.wait(timeout: .now() + 5)
    player.release()
    Thread.sleep(forTimeInterval: 0.3)
  }
}
