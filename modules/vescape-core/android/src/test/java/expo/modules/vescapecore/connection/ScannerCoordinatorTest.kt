package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/connection/ScannerCoordinatorTests.swift */
class ScannerCoordinatorTest {
  private fun granted(coordinator: ScannerCoordinator, purpose: ScanPurpose): ScanOperation {
    val acquisition = coordinator.acquire(purpose)
    assertTrue("expected $purpose to be granted", acquisition is ScanAcquisition.Granted)
    return (acquisition as ScanAcquisition.Granted).operation
  }

  @Test
  fun addBoardScanCannotBePreemptedByPresenceScan() {
    val coordinator = ScannerCoordinator()
    granted(coordinator, ScanPurpose.AddBoard)

    val denied = coordinator.acquire(ScanPurpose.Presence)

    assertTrue(denied is ScanAcquisition.Denied)
    assertEquals(ConnectionTraceReason.SCANNER_BUSY, (denied as ScanAcquisition.Denied).reason)
    assertEquals(ScanPurpose.AddBoard, denied.heldBy)
  }

  @Test
  fun boardProbeCannotBePreemptedByPresenceScan() {
    val coordinator = ScannerCoordinator()
    granted(coordinator, ScanPurpose.BoardProbe)

    assertTrue(coordinator.acquire(ScanPurpose.Presence) is ScanAcquisition.Denied)
  }

  @Test
  fun higherPriorityWorkTakesTheScannerFromPresence() {
    val coordinator = ScannerCoordinator()
    val presence = granted(coordinator, ScanPurpose.Presence)

    granted(coordinator, ScanPurpose.Reconnect)

    assertFalse(coordinator.isCurrent(presence))
  }

  @Test
  fun staleCallbackTokenIsRejected() {
    val coordinator = ScannerCoordinator()
    val first = granted(coordinator, ScanPurpose.Presence)
    coordinator.release(first)
    val second = granted(coordinator, ScanPurpose.Presence)

    assertFalse(coordinator.isCurrent(first))
    assertTrue(coordinator.isCurrent(second))
  }

  @Test
  fun staleReleaseCannotStopANewerScan() {
    val coordinator = ScannerCoordinator()
    val first = granted(coordinator, ScanPurpose.Presence)
    coordinator.release(first)
    val second = granted(coordinator, ScanPurpose.AddBoard)

    assertFalse(coordinator.release(first))
    assertTrue(coordinator.isCurrent(second))

    assertTrue(coordinator.release(second))
    assertNull(coordinator.active)
  }
}
