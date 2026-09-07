package expo.modules.vescapecore.connection

import expo.modules.vescapecore.telemetry.PrivacyZoneEntity
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/connection/PrivacyZoneReadStateTests.swift */
class PrivacyZoneReadStateTest {
  @Test fun `read failure blocks egress and preserves last trusted zones`() {
    val state = PrivacyZoneReadState()
    assertFalse(state.allowsLocationEgress)
    runBlocking { state.reload { emptyList() } }
    assertTrue("a successfully loaded empty list may publish", state.allowsLocationEgress)
    val trusted = PrivacyZoneEntity("zone", "custom", "Home", true, 1, 2, 50, 1, 1)
    runBlocking { state.reload { listOf(trusted) } }
    assertTrue(state.allowsLocationEgress)

    assertThrows(IOException::class.java) {
      runBlocking { state.reload { throw IOException("read failed") } }
    }
    assertFalse("a failed refresh blocks coordinate publication", state.allowsLocationEgress)
    assertEquals(listOf("zone"), state.zones.map { it.id })
  }
}
