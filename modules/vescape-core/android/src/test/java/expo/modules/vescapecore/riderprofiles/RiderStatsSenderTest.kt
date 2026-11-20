package expo.modules.vescapecore.riderprofiles

import java.time.YearMonth
import org.junit.Assert.*
import org.junit.Test

/** @parity /modules/vescape-core/ios/riderprofiles/RiderStatsSenderTests.swift */
class RiderStatsSenderTest {
  private val backfilled = mutableSetOf<String>()
  private val foregrounds = mutableMapOf<String, Long>()
  private fun policy() = RiderStatsUploadPolicy(
    isBackfilled = { it in backfilled }, markBackfilled = { backfilled.add(it); Unit },
    lastForeground = { foregrounds[it] ?: 0 }, markForeground = { account, now -> foregrounds[account] = now },
  )

  @Test fun `ride end selects only its local boundary months and foreground only current plus previous`() {
    val policy = policy()
    val now = YearMonth.of(2026, 1)
    val ride = setOf(YearMonth.of(2025, 11), YearMonth.of(2025, 12))
    assertEquals(ride, policy.months(now, false, ride, null))
    assertEquals(setOf(now, now.minusMonths(1)), policy.months(now, true, ride, null))
    assertEquals(emptySet<YearMonth>(), policy.months(now, false, emptySet(), null))
    val history = ride + YearMonth.of(2020, 3)
    assertEquals(history, policy.months(now, true, ride, history))
  }

  @Test fun `backfill completion survives recreation and is isolated by account with failed passes retried`() {
    val first = policy()
    assertTrue(first.needsBackfill("A"))
    first.finished("A", false)
    assertTrue(policy().needsBackfill("A"))
    first.finished("A", true)
    val restarted = policy()
    assertFalse(restarted.needsBackfill("A"))
    assertTrue(restarted.needsBackfill("B"))
    restarted.finished("B", true)
    assertFalse(policy().needsBackfill("A"))
    assertFalse(policy().needsBackfill("B"))
  }

  @Test fun `same account credential refresh is ignored while sign in and account switch trigger`() {
    val policy = policy()
    assertTrue(policy.accountChanged("A"))
    assertFalse(policy.accountChanged("A"))
    assertTrue(policy.accountChanged("B"))
    assertFalse(policy.accountChanged(null))
    assertTrue(policy.accountChanged("B"))
  }

  @Test fun `foreground throttle survives restart but does not prevent failed backfill retry or ride uploads`() {
    val policy = policy()
    val now = 10_000_000L
    assertTrue(policy.begin("A", true, now))
    assertTrue(policy().begin("A", true, now + 1))
    policy.finished("A", true)
    assertFalse(policy().begin("A", true, now + 2))
    assertTrue(policy.begin("A", false, now + 2))
    assertTrue(policy.begin("A", true, now + 3_600_001))
  }

  @Test fun `normalizes all server fields including nonfinite and fractional integers`() {
    val payload = normalizedRiderStats(mapOf(
      "rideCount" to 100_000.7, "rideTimeMs" to 3e9, "topSpeedKmh" to Double.NaN,
      "avgSpeedKmh" to 1001.0, "distanceM" to Double.POSITIVE_INFINITY,
      "longestRideM" to -1.0, "batteryUsedWh" to 1e9, "batteryRegenWh" to null,
    ))
    assertEquals(100_000L, payload.getLong("rideCount"))
    assertEquals(2_678_400_000L, payload.getLong("rideTimeMs"))
    assertEquals(0.0, payload.getDouble("topSpeedKmh"), 0.0)
    assertEquals(1000.0, payload.getDouble("avgSpeedKmh"), 0.0)
    assertTrue(payload.isNull("distanceM"))
    assertEquals(0.0, payload.getDouble("longestRideM"), 0.0)
    assertEquals(1e8, payload.getDouble("batteryUsedWh"), 0.0)
    assertTrue(payload.isNull("batteryRegenWh"))
    val rounded = normalizedRiderStats(mapOf("rideCount" to 2.5, "rideTimeMs" to 10.5))
    assertEquals(3L, rounded.getLong("rideCount"))
    assertEquals(11L, rounded.getLong("rideTimeMs"))
    val invalid = normalizedRiderStats(mapOf("rideCount" to -1, "rideTimeMs" to Double.NEGATIVE_INFINITY))
    assertEquals(0L, invalid.getLong("rideCount"))
    assertEquals(0L, invalid.getLong("rideTimeMs"))
  }
}
