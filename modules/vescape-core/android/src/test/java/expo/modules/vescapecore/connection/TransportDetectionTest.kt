package expo.modules.vescapecore.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransportDetectionTest {

  private fun probe(
    transport: BoardTransport,
    confirmed: Boolean,
    hasBms: Boolean = false,
    vescFirmwareVersion: String? = null,
    refloatVersion: String? = null,
    refloatBaseVersion: String? = null,
  ) = TransportDetection.Probe(
    transport = transport,
    confirmed = confirmed,
    hasBms = hasBms,
    vescFirmwareVersion = vescFirmwareVersion,
    refloatVersion = refloatVersion,
    refloatBaseVersion = refloatBaseVersion,
  )

  @Test
  fun `probes direct even with no CAN responders`() {
    assertEquals(
      listOf(BoardTransport.Direct),
      TransportDetection.candidatesToProbe(emptyList()),
    )
  }

  @Test
  fun `probes direct first then every responder ascending`() {
    assertEquals(
      listOf(BoardTransport.Direct, BoardTransport.Can(12), BoardTransport.Can(43)),
      TransportDetection.candidatesToProbe(listOf(43, 12)),
    )
  }

  @Test
  fun `dedupes repeated responder ids`() {
    assertEquals(
      listOf(BoardTransport.Direct, BoardTransport.Can(7)),
      TransportDetection.candidatesToProbe(listOf(7, 7, 7)),
    )
  }

  @Test
  fun `direct only confirmed resolves to direct`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = true),
      ),
    )
    assertEquals(listOf(BoardTransport.Direct), result.candidates.map { it.transport })
    assertEquals(TransportDetection.Outcome.Resolved(BoardTransport.Direct), result.outcome)
    assertEquals(BoardTransport.Direct, result.resolvedTransport)
  }

  @Test
  fun `can only confirmed resolves to that can id`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = false),
        probe(BoardTransport.Can(43), confirmed = true),
      ),
    )
    assertEquals(listOf(BoardTransport.Can(43)), result.candidates.map { it.transport })
    assertEquals(TransportDetection.Outcome.Resolved(BoardTransport.Can(43)), result.outcome)
    assertEquals(BoardTransport.Can(43), result.resolvedTransport)
  }

  @Test
  fun `multiple valid can ids need pick in probe order`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = false),
        probe(BoardTransport.Can(12), confirmed = true),
        probe(BoardTransport.Can(43), confirmed = true),
      ),
    )
    assertEquals(
      listOf(BoardTransport.Can(12), BoardTransport.Can(43)),
      result.candidates.map { it.transport },
    )
    assertEquals(
      TransportDetection.Outcome.NeedsPick(
        listOf(BoardTransport.Can(12), BoardTransport.Can(43)),
      ),
      result.outcome,
    )
    assertNull(result.resolvedTransport)
  }

  @Test
  fun `both direct and can valid need pick with direct pre-selected first`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = true),
        probe(BoardTransport.Can(43), confirmed = true),
      ),
    )
    assertEquals(
      listOf(BoardTransport.Direct, BoardTransport.Can(43)),
      result.candidates.map { it.transport },
    )
    val outcome = result.outcome
    assertTrue(outcome is TransportDetection.Outcome.NeedsPick)
    assertEquals(
      BoardTransport.Direct,
      (outcome as TransportDetection.Outcome.NeedsPick).candidates.first(),
    )
  }

  @Test
  fun `no confirmed transport yields none outcome`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = false),
        probe(BoardTransport.Can(43), confirmed = false),
      ),
    )
    assertTrue(result.candidates.isEmpty())
    assertEquals(TransportDetection.Outcome.None, result.outcome)
    assertNull(result.resolvedTransport)
  }

  @Test
  fun `empty probe set yields none outcome`() {
    val result = TransportDetection.resolve(emptyList())
    assertTrue(result.candidates.isEmpty())
    assertEquals(TransportDetection.Outcome.None, result.outcome)
  }

  @Test
  fun `bms presence is carried onto the confirmed candidate`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = true, hasBms = true),
      ),
    )
    assertEquals(
      listOf(TransportDetection.Candidate(BoardTransport.Direct, hasBms = true)),
      result.candidates,
    )
  }

  @Test
  fun `bms capability is tracked per candidate on multi-node bus`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = true, hasBms = false),
        probe(BoardTransport.Can(43), confirmed = true, hasBms = true),
      ),
    )
    assertEquals(
      listOf(
        TransportDetection.Candidate(BoardTransport.Direct, hasBms = false),
        TransportDetection.Candidate(BoardTransport.Can(43), hasBms = true),
      ),
      result.candidates,
    )
  }

  @Test
  fun `bms on an unconfirmed transport is dropped with it`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = false, hasBms = true),
        probe(BoardTransport.Can(7), confirmed = true, hasBms = false),
      ),
    )
    assertEquals(
      listOf(TransportDetection.Candidate(BoardTransport.Can(7), hasBms = false)),
      result.candidates,
    )
  }

  @Test
  fun `firmware identity is carried onto confirmed candidates`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(
          BoardTransport.Can(7),
          confirmed = true,
          hasBms = true,
          vescFirmwareVersion = "FW 6.05",
          refloatVersion = "Refloat 1.3.0-preview2",
          refloatBaseVersion = "1.3.0",
        ),
      ),
    )

    assertEquals(
      listOf(
        TransportDetection.Candidate(
          transport = BoardTransport.Can(7),
          hasBms = true,
          vescFirmwareVersion = "FW 6.05",
          refloatVersion = "Refloat 1.3.0-preview2",
          refloatBaseVersion = "1.3.0",
        ),
      ),
      result.candidates,
    )
  }

  @Test
  fun `missing firmware identity does not drop telemetry confirmed candidate`() {
    val result = TransportDetection.resolve(
      listOf(
        probe(BoardTransport.Direct, confirmed = true, hasBms = false),
      ),
    )

    assertEquals(TransportDetection.Outcome.Resolved(BoardTransport.Direct), result.outcome)
    assertEquals(1, result.candidates.size)
    assertNull(result.candidates.single().vescFirmwareVersion)
    assertNull(result.candidates.single().refloatVersion)
    assertNull(result.candidates.single().refloatBaseVersion)
  }
}
