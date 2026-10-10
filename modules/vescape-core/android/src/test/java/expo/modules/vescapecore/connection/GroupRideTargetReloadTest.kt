package expo.modules.vescapecore.connection

import expo.modules.vescapecore.TargetPoint
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class GroupRideTargetReloadTest {
  @Test fun `read failure preserves target reports and suppresses presence publish`() = runBlocking {
    val previous = TargetPoint(lat = 52.1, lng = 21.0)
    val reports = mutableListOf<String>()
    var publishes = 0

    val reload = reloadGroupRideTarget(
      previous,
      read = { throw IllegalStateException("database read failed") },
      report = { reports += "group_ride_target_read" },
    )
    if (reload.loaded) publishes++

    assertFalse(reload.loaded)
    assertEquals(previous, reload.target)
    assertEquals(listOf("group_ride_target_read"), reports)
    assertEquals(0, publishes)
  }

  @Test fun `cancellation propagates without reporting`() {
    var reports = 0
    assertThrows(CancellationException::class.java) {
      runBlocking {
        reloadGroupRideTarget(null, read = { throw CancellationException("cancelled") }, report = { reports++ })
      }
    }
    assertEquals(0, reports)
  }
}
