package expo.modules.vescapecore.sync

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The send/wait/paused decision, with no database, clock or network behind it.
 *
 * @parity /modules/vescape-core/ios/sync/SyncPolicyTests.swift
 */
class SyncPolicyTest {
  private fun state(
    pendingRows: Int = 1,
    ridingSamples: Boolean = false,
    enabled: Boolean = true,
    online: Boolean = true,
    wifiOnly: Boolean = false,
    onWifi: Boolean = false,
    credentialReady: Boolean = true,
    onlineBlocked: Boolean = false,
    pause: SyncPauseReason? = null,
    retryAtMs: Long = 0,
  ) = SyncState(
    nowMs = 1_000,
    pendingRows = pendingRows,
    ridingSamples = ridingSamples,
    enabled = enabled,
    online = online,
    wifiOnly = wifiOnly,
    onWifi = onWifi,
    credentialReady = credentialReady,
    onlineBlocked = onlineBlocked,
    pause = pause,
    retryAtMs = retryAtMs,
  )

  @Test
  fun `pending rows on a live connection send now`() {
    assertEquals(SyncDecision.SendNow, SyncPolicy.decide(state()))
  }

  @Test
  fun `cadence follows sample production, not session presence`() {
    assertEquals(
      SyncDecision.Wait(1_000 + SyncPolicy.RIDE_INTERVAL_MS),
      SyncPolicy.decide(state(pendingRows = 0, ridingSamples = true)),
    )
    assertEquals(
      SyncDecision.Wait(1_000 + SyncPolicy.IDLE_INTERVAL_MS),
      SyncPolicy.decide(state(pendingRows = 0)),
    )
  }

  /** Offline, metered and gated are pauses in the loop, never failures that move backoff. */
  @Test
  fun `offline, wifi-only on cellular and a closed gate all wait`() {
    val idle = SyncDecision.Wait(1_000 + SyncPolicy.IDLE_INTERVAL_MS)
    assertEquals(idle, SyncPolicy.decide(state(online = false)))
    assertEquals(idle, SyncPolicy.decide(state(wifiOnly = true, onWifi = false)))
    assertEquals(idle, SyncPolicy.decide(state(onlineBlocked = true)))
    assertEquals(SyncDecision.SendNow, SyncPolicy.decide(state(wifiOnly = true, onWifi = true)))
  }

  @Test
  fun `backoff deadline holds the loop until it passes`() {
    assertEquals(SyncDecision.Wait(5_000), SyncPolicy.decide(state(retryAtMs = 5_000)))
    assertEquals(SyncDecision.SendNow, SyncPolicy.decide(state(retryAtMs = 999)))
  }

  @Test
  fun `a pause is not bypassed by an ordinary kick`() {
    assertEquals(
      SyncDecision.Paused(SyncPauseReason.PROTOCOL),
      SyncPolicy.decide(state(pause = SyncPauseReason.PROTOCOL)),
    )
    assertEquals(
      SyncDecision.Paused(SyncPauseReason.AUTHENTICATION),
      SyncPolicy.decide(state(credentialReady = false)),
    )
  }

  @Test
  fun `the master switch stops the uploader outright and outranks every other state`() {
    assertEquals(
      SyncDecision.Wait(1_000 + SyncPolicy.IDLE_INTERVAL_MS),
      SyncPolicy.decide(state(enabled = false)),
    )
    // Not a pause: switched off is not a broken uploader waiting to be resumed.
    assertEquals(
      SyncDecision.Wait(1_000 + SyncPolicy.IDLE_INTERVAL_MS),
      SyncPolicy.decide(state(enabled = false, pause = SyncPauseReason.PROTOCOL)),
    )
    assertEquals(SyncActivity.DISABLED, SyncPolicy.describe(state(enabled = false)))
    assertEquals(
      SyncActivity.DISABLED,
      SyncPolicy.describe(state(enabled = false, credentialReady = false)),
    )
    assertEquals(
      SyncActivity.DISABLED,
      SyncPolicy.describe(state(enabled = false, pause = SyncPauseReason.AUTHENTICATION)),
    )
  }

  @Test
  fun `a phone with no credential reads as signed out, not as a broken backup`() {
    assertEquals(SyncActivity.SIGNED_OUT, SyncPolicy.describe(state(credentialReady = false)))
    assertEquals(
      SyncActivity.SIGNED_OUT,
      SyncPolicy.describe(state(credentialReady = false, pause = SyncPauseReason.AUTHENTICATION)),
    )
  }

  @Test
  fun `every waiting reason is named separately`() {
    assertEquals(SyncActivity.UP_TO_DATE, SyncPolicy.describe(state(pendingRows = 0)))
    assertEquals(SyncActivity.SYNCING, SyncPolicy.describe(state()))
    assertEquals(SyncActivity.OFFLINE, SyncPolicy.describe(state(online = false)))
    assertEquals(SyncActivity.OFFLINE, SyncPolicy.describe(state(onlineBlocked = true)))
    assertEquals(
      SyncActivity.WAITING_FOR_WIFI,
      SyncPolicy.describe(state(wifiOnly = true, onWifi = false)),
    )
    assertEquals(SyncActivity.SYNCING, SyncPolicy.describe(state(wifiOnly = true, onWifi = true)))
  }

  @Test
  fun `a pause outranks everything except being signed out`() {
    assertEquals(
      SyncActivity.PAUSED,
      SyncPolicy.describe(state(pendingRows = 0, pause = SyncPauseReason.PROTOCOL)),
    )
    assertEquals(
      SyncActivity.PAUSED,
      SyncPolicy.describe(state(online = false, pause = SyncPauseReason.ROW_TOO_LARGE)),
    )
  }

  @Test
  fun `a batch waiting on backoff still reads as syncing`() {
    assertEquals(SyncActivity.SYNCING, SyncPolicy.describe(state(retryAtMs = 60_000)))
  }

  @Test
  fun `backoff doubles from the first step and stops at the cap`() {
    assertEquals(SyncPolicy.BACKOFF_START_MS, SyncPolicy.nextBackoffMs(0))
    assertEquals(60_000, SyncPolicy.nextBackoffMs(30_000))
    assertEquals(SyncPolicy.BACKOFF_MAX_MS, SyncPolicy.nextBackoffMs(SyncPolicy.BACKOFF_MAX_MS))
  }
}
