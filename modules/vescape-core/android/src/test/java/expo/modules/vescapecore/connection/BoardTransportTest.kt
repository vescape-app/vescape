package expo.modules.vescapecore.connection

import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class BoardTransportTest {
  @Test
  fun directTransportReturnsCommandUnchanged() {
    val cmd = byteArrayOf(COMM_CUSTOM_APP_DATA.toByte(), REFLOAT_MAGIC.toByte())

    val framed = BoardTransport.Direct.frame(cmd)

    assertSame(cmd, framed)
  }

  @Test
  fun canForwardTransportPrefixesCommand() {
    val cmd = byteArrayOf(COMM_GET_CUSTOM_CONFIG.toByte(), 0)

    val framed = BoardTransport.Can(7).frame(cmd)

    assertArrayEquals(
      byteArrayOf(COMM_FORWARD_CAN.toByte(), 7, COMM_GET_CUSTOM_CONFIG.toByte(), 0),
      framed,
    )
  }

  @Test
  fun canForwardTransportRejectsCanIdsOutsideUint8() {
    assertInvalidCanId(-1)
    assertInvalidCanId(256)
  }

  @Test
  fun `decode maps the persisted tri-state`() {
    assertNull(BoardTransport.decode(null))
    assertEquals(BoardTransport.Direct, BoardTransport.decode("direct"))
    assertEquals(BoardTransport.Can(12), BoardTransport.decode("12"))
  }

  @Test
  fun `decode treats unparseable text as undetected`() {
    assertNull(BoardTransport.decode("garbage"))
    assertNull(BoardTransport.decode(""))
  }

  @Test
  fun `decode treats out-of-range CAN ids as undetected`() {
    assertNull(BoardTransport.decode("-1"))
    assertNull(BoardTransport.decode("256"))
  }

  @Test
  fun `encode round-trips through the persisted form`() {
    listOf(null, BoardTransport.Direct, BoardTransport.Can(0), BoardTransport.Can(63))
      .forEach { assertEquals(it, BoardTransport.decode(BoardTransport.encode(it))) }
  }

  @Test
  fun `fromBridge coerces JS values`() {
    assertNull(BoardTransport.fromBridge(null))
    assertEquals(BoardTransport.Direct, BoardTransport.fromBridge("direct"))
    assertEquals(BoardTransport.Can(7), BoardTransport.fromBridge(7))
    assertEquals(BoardTransport.Can(7), BoardTransport.fromBridge(7.0))
    assertNull(BoardTransport.fromBridge(-1))
    assertNull(BoardTransport.fromBridge(256))
    assertNull(BoardTransport.fromBridge("unexpected"))
  }

  @Test
  fun `toBridge projects to JS values`() {
    assertNull(BoardTransport.toBridge(null))
    assertEquals("direct", BoardTransport.toBridge(BoardTransport.Direct))
    assertEquals(7, BoardTransport.toBridge(BoardTransport.Can(7)))
  }

  private fun assertInvalidCanId(canId: Int) {
    try {
      BoardTransport.Can(canId)
      fail("Expected invalid CAN id to throw")
    } catch (e: IllegalArgumentException) {
    }
  }
}
