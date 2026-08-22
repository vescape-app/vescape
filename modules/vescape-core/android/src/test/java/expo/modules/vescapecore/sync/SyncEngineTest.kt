package expo.modules.vescapecore.sync

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The engine against a fake transport: the cases that decide whether a Rider's data survives — a
 * wedged batch, a failure part-way through a drain, a dead token, and a response that outlived the
 * Account it was sent for.
 *
 * @parity /modules/vescape-core/ios/sync/SyncEngineTests.swift
 */
class SyncEngineTest {
  /** Two rows per scan, so a backlog of four takes two passes — the shape these cases were written against. */
  private fun FakeSource(rows: Int = 3) = FakeSyncSource(rows).also { it.scanLimit = 2 }

  private fun accepted(boards: Int): String {
    val counts = SyncTable.entries.joinToString(",") {
      "\"${it.wire}\":${if (it == SyncTable.BOARDS) boards else 0}"
    }
    return "{\"accepted\":{$counts}}"
  }

  private fun engine(
    source: SyncSource,
    responses: MutableList<SyncResponse>,
    sent: MutableList<String> = mutableListOf(),
  ) = SyncEngine(
    source = source,
    transport = { body ->
      sent += body
      responses.removeAt(0)
    },
    environment = {
      SyncEnvironment(
        ridingSamples = false,
        enabled = true,
        online = true,
        wifiOnly = false,
        onWifi = false,
        credentialReady = true,
        onlineBlocked = false,
      )
    },
    clock = { 1_000 },
  )

  @Test
  fun `a valid 200 advances only the rows it accounted for`() = runBlocking {
    val source = FakeSource(rows = 2)
    val engine = engine(source, mutableListOf(SyncResponse.Accepted(accepted(2))))

    assertEquals(SyncPass.Sent(2, morePending = false), engine.runOnce())
    assertEquals(listOf(mapOf(SyncTable.BOARDS to 2L)), source.committed)
  }

  @Test
  fun `a mismatched accepted count is a protocol failure and moves no cursor`() = runBlocking {
    val source = FakeSource(rows = 2)
    val engine = engine(source, mutableListOf(SyncResponse.Accepted(accepted(1))))

    assertEquals(SyncPass.Paused(SyncPauseReason.PROTOCOL), engine.runOnce())
    assertTrue(source.committed.isEmpty())
    assertEquals(listOf(SyncPauseReason.PROTOCOL to "acceptedMismatch"), source.failures)
  }

  @Test
  fun `a malformed success body never advances a cursor`() = runBlocking {
    val source = FakeSource(rows = 2)
    val engine = engine(source, mutableListOf(SyncResponse.Accepted("not json")))

    assertEquals(SyncPass.Paused(SyncPauseReason.PROTOCOL), engine.runOnce())
    assertTrue(source.committed.isEmpty())
  }

  @Test
  fun `a refused batch leaves every cursor untouched and does not retry on a kick`() = runBlocking {
    val source = FakeSource(rows = 2)
    val engine = engine(
      source,
      mutableListOf(SyncResponse.Invalid(409, "dependency-conflict")),
    )

    assertEquals(SyncPass.Paused(SyncPauseReason.PROTOCOL), engine.runOnce())
    assertTrue(source.committed.isEmpty())
    // No second response is queued, so a pass that sent again would fail the test outright.
    assertEquals(SyncPass.Paused(SyncPauseReason.PROTOCOL), engine.runOnce())
  }

  @Test
  fun `a failure part-way through a drain leaves cursors at the last accepted batch`() = runBlocking {
    val source = FakeSource(rows = 4)
    val engine = engine(
      source,
      mutableListOf(
        SyncResponse.Accepted(accepted(2)),
        SyncResponse.Transient("5xx"),
      ),
    )

    assertEquals(SyncPass.Sent(2, morePending = true), engine.runOnce())
    val second = engine.runOnce()
    assertTrue(second is SyncPass.Waiting)
    assertEquals(listOf(mapOf(SyncTable.BOARDS to 2L)), source.committed)
  }

  @Test
  fun `a dead token stops the loop for sign-in`() = runBlocking {
    val source = FakeSource(rows = 2)
    val engine = engine(source, mutableListOf(SyncResponse.Unauthorized))

    assertEquals(SyncPass.Paused(SyncPauseReason.AUTHENTICATION), engine.runOnce())
    assertEquals(SyncPauseReason.AUTHENTICATION, engine.pauseReason)
    assertTrue(source.committed.isEmpty())
  }

  @Test
  fun `a response from the previous Account cannot advance a cursor`() = runBlocking {
    val source = FakeSource(rows = 2)
    val engine = SyncEngine(
      source = source,
      transport = {
        // The Account changed while this request was in flight.
        source.generation += 1
        SyncResponse.Accepted(accepted(2))
      },
      environment = {
        SyncEnvironment(
          ridingSamples = false,
          enabled = true,
          online = true,
          wifiOnly = false,
          onWifi = false,
          credentialReady = true,
          onlineBlocked = false,
        )
      },
      clock = { 1_000 },
    )

    assertEquals(SyncPass.Idle, engine.runOnce())
    assertTrue(source.committed.isEmpty())
  }

  @Test
  fun `a timeout after the server committed resends the identical batch`() = runBlocking {
    val source = FakeSource(rows = 2)
    val sent = mutableListOf<String>()
    val engine = engine(
      source,
      mutableListOf(SyncResponse.Transient("timeout"), SyncResponse.Accepted(accepted(2))),
      sent,
    )

    engine.runOnce()
    engine.resume()
    engine.runOnce()
    assertEquals(2, sent.size)
    assertEquals(sent[0], sent[1])
  }

  @Test
  fun `413 narrows the byte target and a single row that still fails pauses without being skipped`() =
    runBlocking {
      val source = FakeSource(rows = 1)
      val engine = engine(source, mutableListOf(SyncResponse.TooLarge))

      assertEquals(SyncPass.Paused(SyncPauseReason.ROW_TOO_LARGE), engine.runOnce())
      assertTrue(source.committed.isEmpty())
      assertEquals(1, source.remaining)
    }

  /** A shrink accepted nothing, so it must not be reported as an upload. */
  @Test
  fun `413 on a multi-row batch narrows the target and retries`() = runBlocking {
    val source = FakeSource(rows = 4)
    val engine = engine(source, mutableListOf(SyncResponse.TooLarge))

    assertEquals(SyncPass.Retry, engine.runOnce())
    assertTrue(source.committed.isEmpty())
    assertEquals(4, source.remaining)
  }

  /** Halving forever against a server that keeps refusing would be an unbounded request storm. */
  @Test
  fun `413 at the smallest batch pauses instead of resending the same bytes forever`() = runBlocking {
    val source = FakeSource(rows = 4)
    val engine = engine(source, MutableList(10) { SyncResponse.TooLarge })

    var passes = 0
    var outcome = engine.runOnce()
    while (outcome == SyncPass.Retry && passes < 10) {
      outcome = engine.runOnce()
      passes += 1
    }
    assertEquals(SyncPass.Paused(SyncPauseReason.ROW_TOO_LARGE), outcome)
    assertTrue(source.committed.isEmpty())
  }

  /** The server took the rows; the checkpoint did not land. Resending is safe, claiming success is not. */
  @Test
  fun `a failed cursor commit backs off instead of reporting an upload`() = runBlocking {
    val source = FakeSource(rows = 2)
    source.commitFailure = IllegalStateException("disk full")
    val engine = engine(source, mutableListOf(SyncResponse.Accepted(accepted(2))))

    val outcome = engine.runOnce()
    assertTrue(outcome is SyncPass.Waiting)
    assertTrue(source.committed.isEmpty())
    assertEquals(2, source.remaining)
  }

  @Test
  fun `429 waits for the server's own delay`() = runBlocking {
    val source = FakeSource(rows = 2)
    val engine = engine(source, mutableListOf(SyncResponse.RateLimited(90_000)))

    assertEquals(SyncPass.Waiting(91_000), engine.runOnce())
    assertNull(engine.pauseReason)
  }

  @Test
  fun `a row that cannot be encoded pauses with the row retained`() = runBlocking {
    val source = FakeSource(rows = 2)
    source.encodeFailure = SyncProtocolException(SyncTable.BOARDS, "id", "must not be empty")
    val engine = engine(source, mutableListOf())

    assertEquals(SyncPass.Paused(SyncPauseReason.PROTOCOL), engine.runOnce())
    assertEquals(listOf(SyncPauseReason.PROTOCOL to "boards.id"), source.failures)
    assertEquals(2, source.remaining)
  }
}
