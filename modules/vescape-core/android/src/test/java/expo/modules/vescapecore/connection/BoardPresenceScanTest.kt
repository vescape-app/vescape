package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import expo.modules.vescapecore.runtime.TestScheduler

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/connection/BoardPresenceScanTests.swift */
class BoardPresenceScanTest {
  private class FakePort(
    var bluetooth: Boolean = true,
    var permission: Boolean = true,
    var available: Boolean = true,
    /** Delay between `startScan` and readiness, standing in for Bluetooth powering on. */
    var readyDelayMs: Long = 0L,
    var startSucceeds: Boolean = true,
    private val scheduler: TestScheduler,
  ) : PresenceScanPort {
    var stopped = 0
    private var observed: ((String, Int?) -> Unit)? = null

    override fun bluetoothEnabled() = bluetooth

    override fun scanPermissionGranted() = permission

    override fun scannerAvailable() = available

    override fun startScan(
      onReady: () -> Unit,
      onObserved: (String, Int?) -> Unit,
      onFailed: (String) -> Unit,
    ): Boolean {
      if (!startSucceeds) return false
      observed = onObserved
      scheduler.postDelayed(readyDelayMs) { onReady() }
      return true
    }

    override fun stopScan() {
      stopped += 1
      observed = null
    }

    fun advertise(bleId: String, rssi: Int? = -60) {
      observed?.invoke(bleId, rssi)
    }
  }

  private class Fixture(
    val scheduler: TestScheduler = TestScheduler(),
    autoConnectEnabled: Boolean = true,
    pausedUntilMs: Long? = null,
    val scanner: ScannerCoordinator = ScannerCoordinator(),
    val ownership: ConnectionOwnership = ConnectionOwnership(),
  ) {
    val port = FakePort(scheduler = scheduler)
    val promoted = mutableListOf<PresenceTarget>()
    var autoConnect = autoConnectEnabled
    var paused = pausedUntilMs
    val scan = BoardPresenceScan(
      port = port,
      scanner = scanner,
      ownership = ownership,
      scheduler = scheduler,
      nowMs = { scheduler.currentTimeMs },
      onPromote = { target, _ -> promoted.add(target) },
    )

    val targets = listOf(
      PresenceTarget(boardId = "board-1", bleId = "AA:BB", name = "Mine", selected = true),
      PresenceTarget(boardId = "board-2", bleId = "CC:DD", name = "Other", selected = false),
    )

    fun start(environment: PresenceScanEnvironment = environment()): PresenceScanDecision =
      scan.start(
        environment = environment,
        targets = targets,
        promotionInput = {
          PresencePromotionInput(
            selectedObserved = true,
            autoConnectEnabled = autoConnect,
            pausedUntilMs = paused,
            nowMs = scheduler.currentTimeMs,
            sessionActive = false,
            currentOwner = ownership.current,
          )
        },
      )

    fun environment(
      sessionActive: Boolean = false,
      activeScanPurpose: ScanPurpose? = null,
    ) = PresenceScanEnvironment(
      linkedBoardCount = targets.size,
      selectedBoardId = "board-1",
      selectedBoardBleId = "AA:BB",
      bluetoothEnabled = port.bluetooth,
      scanPermissionGranted = port.permission,
      scannerAvailable = port.available,
      sessionActive = sessionActive,
      connectIntentActive = false,
      activeScanPurpose = activeScanPurpose,
    )
  }

  @Test
  fun fiveSecondDeadlineStartsAfterBluetoothIsReady() {
    val fixture = Fixture()
    fixture.port.readyDelayMs = 3_000L

    fixture.start()
    assertEquals(PresenceScanPhase.WaitingForBluetooth, fixture.scan.state.phase)
    assertNull(fixture.scan.state.deadlineAtMs)

    fixture.scheduler.advance(3_000L)
    assertEquals(PresenceScanPhase.Scanning, fixture.scan.state.phase)
    assertEquals(8_000L, fixture.scan.state.deadlineAtMs)

    // 4.9s after readiness — 7.9s after foreground entry — the scan is still looking.
    fixture.scheduler.advance(4_900L)
    assertEquals(PresenceScanPhase.Scanning, fixture.scan.state.phase)

    fixture.scheduler.advance(100L)
    assertEquals(PresenceScanPhase.Done, fixture.scan.state.phase)
    assertEquals(ConnectionTraceReason.BOARD_NOT_PRESENT, fixture.scan.state.reason)
  }

  @Test
  fun observedSelectedBoardPromotesIntoASession() {
    val fixture = Fixture()
    fixture.start()
    fixture.scheduler.advance(0L)

    fixture.port.advertise("AA:BB")
    fixture.scheduler.advance(0L)

    assertEquals(listOf("board-1"), fixture.promoted.map { it.boardId })
    assertEquals(ConnectionOwner.BoardSession, fixture.ownership.current)
    assertEquals(1, fixture.port.stopped)
  }

  @Test
  fun nonSelectedBoardIsObservedButNeverConnected() {
    val fixture = Fixture()
    fixture.start()
    fixture.scheduler.advance(0L)

    fixture.port.advertise("CC:DD", rssi = -71)
    fixture.scheduler.advance(0L)

    val observation = fixture.scan.state.observations.single()
    assertEquals("board-2", observation.boardId)
    assertFalse(observation.selected)
    assertEquals(-71, observation.rssi)
    assertTrue(fixture.promoted.isEmpty())
    assertTrue(fixture.scan.isRunning)
  }

  @Test
  fun matchDoesNotPromoteWhileAutoConnectIsOff() {
    val fixture = Fixture(autoConnectEnabled = false)
    fixture.start()
    fixture.scheduler.advance(0L)

    fixture.port.advertise("AA:BB")
    fixture.scheduler.advance(0L)

    assertTrue(fixture.promoted.isEmpty())
    assertEquals(ConnectionTraceReason.AUTO_CONNECT_DISABLED, fixture.scan.state.reason)
    assertEquals("board-1", fixture.scan.state.observations.single().boardId)
    assertEquals(ConnectionOwner.None, fixture.ownership.current)
  }

  @Test
  fun matchDoesNotPromoteWhileTheBoardIsPaused() {
    val fixture = Fixture(pausedUntilMs = 60_000L)
    fixture.start()
    fixture.scheduler.advance(0L)

    fixture.port.advertise("AA:BB")
    fixture.scheduler.advance(0L)

    assertTrue(fixture.promoted.isEmpty())
    assertEquals(ConnectionTraceReason.CONNECTION_PAUSED, fixture.scan.state.reason)
  }

  @Test
  fun refusesToStartWhileAnExclusiveScannerOwnerRuns() {
    val fixture = Fixture()

    val decision = fixture.start(fixture.environment(activeScanPurpose = ScanPurpose.AddBoard))

    assertFalse(decision.proceed)
    assertEquals(ConnectionTraceReason.SCANNER_BUSY, decision.reason)
    assertFalse(fixture.scan.isRunning)
  }

  @Test
  fun refusesToStartWhileASessionIsAlreadyActive() {
    val fixture = Fixture()

    val decision = fixture.start(fixture.environment(sessionActive = true))

    assertEquals(ConnectionTraceDecision.SKIPPED, decision.decision)
    assertEquals(ConnectionTraceReason.SESSION_ALREADY_ACTIVE, decision.reason)
  }

  @Test
  fun staleCallbacksAfterCancellationAreDropped() {
    val fixture = Fixture()
    fixture.start()
    fixture.scheduler.advance(0L)

    fixture.scan.cancel(ConnectionTraceReason.STOP_SEARCH)
    fixture.port.advertise("AA:BB")
    fixture.scheduler.advance(0L)

    assertTrue(fixture.promoted.isEmpty())
    assertTrue(fixture.scan.state.observations.isEmpty())
    assertEquals(ConnectionTraceReason.STOP_SEARCH, fixture.scan.state.reason)
    assertEquals(ConnectionOwner.None, fixture.ownership.current)
  }

  @Test
  fun aFailedScanStartIsNamedNotSilent() {
    val fixture = Fixture()
    fixture.port.startSucceeds = false

    val decision = fixture.start()

    assertFalse(decision.proceed)
    assertEquals(ConnectionTraceReason.SCANNER_UNAVAILABLE, decision.reason)
    assertFalse(fixture.scan.isRunning)
    assertEquals(ConnectionOwner.None, fixture.ownership.current)
  }
}
