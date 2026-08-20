import XCTest
@testable import VescapeCore

/// Automatic Connection Pause map (ADR 0035, #406): rider intent arms a board-scoped deadline,
/// explicit Connect clears it, and mechanics never arm one.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/ConnectionPauseTest.kt
final class ConnectionPauseTests: XCTestCase {
  private var defaults: UserDefaults!
  private var store: ConnectionPauseStore!
  private let now: Int64 = 1_000_000

  override func setUp() {
    super.setUp()
    defaults = UserDefaults(suiteName: "ConnectionPauseTests")
    defaults.removePersistentDomain(forName: "ConnectionPauseTests")
    store = ConnectionPauseStore(defaults: defaults)
  }

  override func tearDown() {
    defaults.removePersistentDomain(forName: "ConnectionPauseTests")
    super.tearDown()
  }

  func testEveryRiderIntentArmsAPauseAndNothingElseDoes() {
    for source in [
      ConnectionTraceReason.manualDisconnect,
      ConnectionTraceReason.endRide,
      ConnectionTraceReason.appExit,
      ConnectionTraceReason.taskRemoved,
    ] {
      XCTAssertTrue(ConnectionPausePolicy.arms(source), source)
    }
    // Mechanics must never suppress Auto Connect — this is the whole hazard of the slice.
    for source in [
      ConnectionTraceReason.mechanicalTeardown,
      ConnectionTraceReason.probeCancelled,
      ConnectionTraceReason.stopSearch,
      ConnectionTraceReason.deadlineExpired,
      ConnectionTraceReason.autoClose,
      ConnectionTraceReason.userCancelled,
    ] {
      XCTAssertFalse(ConnectionPausePolicy.arms(source), source)
    }
  }

  func testMechanicalSourceStoresNothing() {
    XCTAssertNil(
      store.arm(
        boardId: "board-1",
        source: ConnectionTraceReason.mechanicalTeardown,
        minutes: 60,
        nowMs: now
      )
    )
    XCTAssertNil(defaults.dictionary(forKey: ConnectionPauseStore.storageKey))
    XCTAssertNil(store.active(boardId: "board-1", nowMs: now))
  }

  func testZeroDurationMeansTheRiderOptedOutOfPausing() {
    XCTAssertNil(
      store.arm(
        boardId: "board-1",
        source: ConnectionTraceReason.manualDisconnect,
        minutes: 0,
        nowMs: now
      )
    )
    XCTAssertNil(store.pausedUntilMs(boardId: "board-1", nowMs: now))
    XCTAssertNil(defaults.dictionary(forKey: ConnectionPauseStore.storageKey))
  }

  func testPauseExpiresByAbsoluteDeadline() {
    let pause = store.arm(
      boardId: "board-1",
      source: ConnectionTraceReason.endRide,
      minutes: 30,
      nowMs: now
    )
    XCTAssertEqual(pause?.untilMs, now + 30 * 60_000)

    XCTAssertEqual(store.pausedUntilMs(boardId: "board-1", nowMs: now + 29 * 60_000), pause?.untilMs)
    XCTAssertNil(store.active(boardId: "board-1", nowMs: now + 31 * 60_000))
    // The expired entry is dropped on read; no cleanup job exists.
    XCTAssertNil(defaults.dictionary(forKey: ConnectionPauseStore.storageKey))
  }

  func testBoardsPauseIndependentlyAndKeepTheirOwnReason() {
    store.arm(boardId: "board-1", source: ConnectionTraceReason.manualDisconnect, minutes: 10, nowMs: now)
    store.arm(boardId: "board-2", source: ConnectionTraceReason.taskRemoved, minutes: 60, nowMs: now)

    XCTAssertEqual(store.active(boardId: "board-1", nowMs: now)?.source, ConnectionTraceReason.manualDisconnect)
    XCTAssertEqual(store.active(boardId: "board-2", nowMs: now)?.source, ConnectionTraceReason.taskRemoved)

    let later = now + 20 * 60_000
    XCTAssertNil(store.active(boardId: "board-1", nowMs: later))
    XCTAssertEqual(store.active(boardId: "board-2", nowMs: later)?.source, ConnectionTraceReason.taskRemoved)
  }

  func testExplicitConnectClearsOnlyTheAffectedBoard() {
    store.arm(boardId: "board-1", source: ConnectionTraceReason.manualDisconnect, minutes: 60, nowMs: now)
    store.arm(boardId: "board-2", source: ConnectionTraceReason.appExit, minutes: 60, nowMs: now)

    store.clear(boardId: "board-1")

    XCTAssertNil(store.active(boardId: "board-1", nowMs: now))
    XCTAssertNotNil(store.active(boardId: "board-2", nowMs: now))
  }

  func testPauseSurvivesAProcessRestart() {
    store.arm(boardId: "board-1", source: ConnectionTraceReason.appExit, minutes: 60, nowMs: now)

    // A fresh store over the same persisted defaults — the force-quit case.
    let restarted = ConnectionPauseStore(defaults: defaults)

    XCTAssertEqual(restarted.active(boardId: "board-1", nowMs: now)?.source, ConnectionTraceReason.appExit)
    XCTAssertNil(restarted.active(boardId: "board-1", nowMs: now + 61 * 60_000))
  }

  func testCorruptPersistedStateFailsOpen() {
    defaults.set(["board-1": "nonsense"], forKey: ConnectionPauseStore.storageKey)
    XCTAssertNil(store.active(boardId: "board-1", nowMs: now))
    XCTAssertTrue(store.entries().isEmpty)
  }

  func testPromotionIsBlockedWhilePausedAndAllowedOnceItExpires() {
    let pause = store.arm(
      boardId: "board-1",
      source: ConnectionTraceReason.manualDisconnect,
      minutes: 60,
      nowMs: now
    )!

    let blocked = PresenceScanPolicy.promotion(
      PresencePromotionInput(
        selectedObserved: true,
        autoConnectEnabled: true,
        pausedUntilMs: pause.untilMs,
        nowMs: now,
        sessionActive: false,
        currentOwner: .none
      )
    )
    XCTAssertFalse(blocked.proceed)
    XCTAssertEqual(blocked.reason, ConnectionTraceReason.connectionPaused)

    let allowed = PresenceScanPolicy.promotion(
      PresencePromotionInput(
        selectedObserved: true,
        autoConnectEnabled: true,
        pausedUntilMs: pause.untilMs,
        nowMs: pause.untilMs + 1,
        sessionActive: false,
        currentOwner: .none
      )
    )
    XCTAssertTrue(allowed.proceed)
  }

  /// The pre-#406 companion cooldown carries over verbatim: no reset, and no clamp to the new 8h
  /// recommendation.
  func testLegacyCooldownSettingMigratesWithoutClamping() {
    XCTAssertEqual(AppDataRepository.automaticConnectionPauseMinutes(720), 720)
    XCTAssertEqual(AppDataRepository.automaticConnectionPauseMinutes(1440), 1440)
    XCTAssertEqual(AppDataRepository.automaticConnectionPauseMinutes(0), 0)
    // Out of range values are pulled into the storable range, not to the recommendation.
    XCTAssertEqual(AppDataRepository.automaticConnectionPauseMinutes(-5), 0)
    XCTAssertEqual(AppDataRepository.automaticConnectionPauseMinutes(9000), ConnectionPausePolicy.maxPauseMinutes)
    XCTAssertNil(AppDataRepository.automaticConnectionPauseMinutes("60"))
    XCTAssertEqual(AppDataRepository.defaultSettings["automaticConnectionPauseMinutes"] as? Int, 60)
  }
}
